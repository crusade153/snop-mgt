'use client';

// 월별 순매출 추이 — 당기 vs 전년 동월 그룹 막대.
// 외부 차트 라이브러리 없이 canvas 로 직접 그린다(이 저장소의 차트 규약).

import { useEffect, useRef, useState } from 'react';
import { formatEok, formatRate, type SalesMonthPoint } from '@/lib/sales-report/board';

/**
 * 색은 dataviz 검증 팔레트의 1·2번 슬롯(파랑·주황)이다.
 * 두 계열 모두 같은 단위(원)이고 **축도 하나**다 — 이중 축 금지.
 */
const COLOR_CURRENT = '#2a78d6';
const COLOR_PREVIOUS = '#c9cdd4';

interface Props {
  data: SalesMonthPoint[];
  height?: number;
}

interface HoverState {
  index: number;
  /** 말풍선의 왼쪽 좌표. 폭 계산은 **이벤트 핸들러에서** 끝내 둔다 — 렌더 중 ref 를 읽지 않기 위한 것이다. */
  left: number;
}

/** 말풍선 대략 폭 — 좌우로 넘치지 않게 가두는 데만 쓴다. */
const TOOLTIP_WIDTH = 150;

export default function SalesTrendChart({ data, height = 260 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  /** 막대의 화면 좌표를 그릴 때 기록해 두고 마우스 히트 판정에 그대로 쓴다. */
  const bandsRef = useRef<{ x: number; width: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (data.length === 0) return;

    const padLeft = 52;
    const padRight = 12;
    const padTop = 16;
    const padBottom = 30;
    const plotW = Math.max(width - padLeft - padRight, 10);
    const plotH = Math.max(height - padTop - padBottom, 10);

    // 두 계열을 같은 축에 세우려면 스케일도 하나여야 한다.
    const peak = Math.max(
      ...data.map((d) => Math.max(d.net, d.prevNet ?? 0)),
      1,
    );
    const maxVal = peak * 1.15;
    const yOf = (v: number) => padTop + plotH - (v / maxVal) * plotH;

    // ── 격자와 눈금(억) — 데이터보다 뒤로 물러나 있어야 한다 ──
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const ticks = 4;
    for (let i = 0; i <= ticks; i += 1) {
      const value = (maxVal / ticks) * i;
      const y = yOf(value);
      ctx.strokeStyle = i === 0 ? '#d4d4d4' : '#f0f0f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, Math.round(y) + 0.5);
      ctx.lineTo(width - padRight, Math.round(y) + 0.5);
      ctx.stroke();

      ctx.fillStyle = '#a3a3a3';
      ctx.fillText(`${(value / 1e8).toFixed(0)}억`, padLeft - 8, y);
    }

    // ── 막대 ────────────────────────────────────────────────
    const band = plotW / data.length;
    // 얇은 마크. 한 밴드 안에 전년·당기 두 개가 2px 간격으로 나란히 선다.
    const gap = 2;
    const barW = Math.max(Math.min((band - 14 - gap) / 2, 22), 3);
    const bands: { x: number; width: number }[] = [];

    ctx.textAlign = 'center';
    data.forEach((point, index) => {
      const center = padLeft + band * index + band / 2;
      bands.push({ x: padLeft + band * index, width: band });

      const prevX = center - barW - gap / 2;
      const curX = center + gap / 2;
      const baseY = yOf(0);

      const drawBar = (x: number, value: number, color: string) => {
        if (value <= 0) return;
        const y = yOf(value);
        const h = Math.max(baseY - y, 1);
        ctx.fillStyle = color;
        ctx.beginPath();
        // 데이터 끝만 4px 둥글게, 바닥은 축에 붙인다.
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barW, h, [4, 4, 0, 0]);
        } else {
          ctx.rect(x, y, barW, h);
        }
        ctx.fill();
      };

      drawBar(prevX, point.prevNet ?? 0, COLOR_PREVIOUS);
      drawBar(curX, point.net, COLOR_CURRENT);

      // 마우스가 올라온 밴드만 밝게 남기고 나머지는 그대로 둔다(색을 바꾸지 않는다).
      if (hover?.index === index) {
        ctx.fillStyle = 'rgba(42, 120, 214, 0.06)';
        ctx.fillRect(padLeft + band * index, padTop, band, plotH);
      }

      // 축 라벨은 좁아지면 건너뛴다 — 겹친 글씨보다 빈 자리가 낫다.
      const labelStep = band < 34 ? Math.ceil(34 / band) : 1;
      if (index % labelStep === 0) {
        ctx.fillStyle = '#737373';
        ctx.textBaseline = 'top';
        ctx.fillText(point.label, center, padTop + plotH + 8);
      }
    });

    bandsRef.current = bands;
  }, [data, height, hover]);

  const point = hover ? data[hover.index] : null;

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        className="w-full block"
        style={{ height }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const index = bandsRef.current.findIndex((b) => x >= b.x && x < b.x + b.width);
          if (index < 0) {
            setHover(null);
            return;
          }
          const left = Math.min(Math.max(x - TOOLTIP_WIDTH / 2, 0), Math.max(rect.width - TOOLTIP_WIDTH, 0));
          setHover({ index, left });
        }}
        onMouseLeave={() => setHover(null)}
      />

      {point && hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-neutral-200 bg-white px-3 py-2 shadow-lg text-xs whitespace-nowrap"
          style={{ left: hover.left, top: 8, width: TOOLTIP_WIDTH }}
        >
          <div className="font-bold text-neutral-900 mb-1">{point.ym.slice(0, 4)}년 {Number(point.ym.slice(4, 6))}월</div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COLOR_CURRENT }} />
            <span className="text-neutral-500">당기</span>
            <span className="ml-auto font-semibold text-neutral-900">{formatEok(point.net)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: COLOR_PREVIOUS }} />
            <span className="text-neutral-500">전년</span>
            <span className="ml-auto font-semibold text-neutral-900">
              {point.prevNet === null ? '—' : formatEok(point.prevNet)}
            </span>
          </div>
          <div className="mt-1 pt-1 border-t border-neutral-100 flex items-center gap-2">
            <span className="text-neutral-500">전년 대비</span>
            <span
              className={`ml-auto font-bold ${
                point.prevNet && point.net - point.prevNet < 0 ? 'text-[#C62828]' : 'text-[#1565C0]'
              }`}
            >
              {point.prevNet
                ? formatRate(((point.net - point.prevNet) / Math.abs(point.prevNet)) * 100)
                : '—'}
            </span>
          </div>
        </div>
      )}

      {/* 계열이 둘이므로 범례는 항상 있다 — 색만으로 구분하게 두지 않는다. */}
      <div className="flex items-center justify-center gap-4 mt-1 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_CURRENT }} />
          당기
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_PREVIOUS }} />
          전년 동월
        </span>
      </div>
    </div>
  );
}
