'use client';

import { useEffect, useRef } from 'react';

interface Series {
  label: string;
  color: string;
  /** 카테고리별 값 (억원) */
  values: number[];
  /**
   * 위험 구간인지. 위험 구간만 진한 색·굵은 글씨로 그리고 나머지는 뒤로 물린다.
   * 보고자가 "어디가 문제인가"를 색 하나로 먼저 읽게 하려는 것이다.
   */
  emphasis?: boolean;
}

interface Props {
  /** X축 라벨 (카테고리) */
  labels: string[];
  series: Series[];
  height?: number;
  /** 각 조각 안에 값·비중을 쓸지. 조각이 얇으면 자동으로 생략된다 */
  showSegmentLabels?: boolean;
}

/** 배경색 대비로 글자색을 고른다. 노란 조각 위의 흰 글씨가 안 읽히던 문제를 막는다. */
function readableTextColor(hex: string) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // sRGB 상대 휘도 근사식
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#37474F' : '#FFFFFF';
}

/**
 * 축 눈금을 읽기 좋은 값으로 떨어뜨린다. 0·7·15·22·30 같은 눈금은 읽는 데 품이 든다.
 *
 * ⚠️ 사다리가 성기면(1·2·5·10) 최대값 43 에 축이 80까지 올라가 막대가 화면 절반만 쓴다.
 * 여유는 5% 만 두고 사다리를 촘촘하게 잡아 막대가 축을 꽉 채우게 한다.
 */
const AXIS_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceAxisMax(rawMax: number, tickCount: number) {
  if (rawMax <= 0) return tickCount;
  const rough = (rawMax * 1.05) / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (AXIS_STEPS.find((candidate) => normalized <= candidate) ?? 10) * magnitude;
  return step * tickCount;
}

/** 억원 표기. 10억 미만은 반올림하면 `0억` 이 되어 버려서 소수 한 자리를 남긴다. */
function eokText(value: number) {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

/**
 * 카테고리별 누적 막대 — 원본 주간 엑셀의 「카테고리별 소비기한별 재고금액」 차트.
 *
 * 별도 데이터 소스가 없다. 메인 표의 구간별 재고금액을 억원으로 접어 그대로 쌓는다.
 * 외부 차트 라이브러리 없이 canvas 로 직접 그리는 이 저장소 관례를 따른다.
 *
 * 읽는 순서를 **위험(빨강) → 총액 → 안전(연한 색)** 으로 고정한 것이 이 차트의 설계다.
 * 막대 위에는 총액과 함께 `위험 n억 (m%)` 을 빨간 글씨로 얹어, 표를 읽기 전에 문제 카테고리가 먼저 눈에 들어오게 한다.
 */
export default function CanvasStackedBarChart({
  labels,
  series,
  height = 300,
  showSegmentLabels = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, height);

    const paddingLeft = 40;
    const paddingRight = 12;
    // 막대 위에 총액 + 위험 문구 두 줄이 올라간다
    const paddingTop = 40;
    const paddingBottom = 34;
    const chartWidth = rect.width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    if (chartWidth <= 0 || chartHeight <= 0) return;

    const totals = labels.map((_, index) =>
      series.reduce((sum, entry) => sum + (entry.values[index] || 0), 0)
    );
    const risks = labels.map((_, index) =>
      series.reduce((sum, entry) => sum + (entry.emphasis ? entry.values[index] || 0 : 0), 0)
    );
    const tickCount = 5;
    const axisMax = niceAxisMax(Math.max(...totals, 1), tickCount);
    const scale = chartHeight / axisMax;

    // Y축 눈금 — 선은 옅게, 숫자는 작게. 막대가 주인공이다.
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let index = 0; index <= tickCount; index += 1) {
      const value = (axisMax / tickCount) * index;
      const y = paddingTop + chartHeight - value * scale;
      ctx.strokeStyle = index === 0 ? '#BDBDBD' : '#F1F1F1';
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + chartWidth, y);
      ctx.stroke();
      ctx.fillStyle = '#BDBDBD';
      ctx.fillText(String(Math.round(value)), paddingLeft - 8, y + 3.5);
    }

    const slotWidth = chartWidth / labels.length;
    const barWidth = Math.min(slotWidth * 0.5, 58);

    labels.forEach((label, index) => {
      const x = paddingLeft + slotWidth * index + (slotWidth - barWidth) / 2;
      let cursorY = paddingTop + chartHeight;
      const total = totals[index];
      const risk = risks[index];

      series.forEach((entry) => {
        const value = entry.values[index] || 0;
        if (value <= 0) return;
        const segmentHeight = value * scale;
        cursorY -= segmentHeight;

        ctx.fillStyle = entry.color;
        ctx.fillRect(x, cursorY, barWidth, segmentHeight);

        // 조각이 너무 얇으면 글자가 겹치므로 생략한다
        if (showSegmentLabels && segmentHeight >= 15 && total > 0) {
          ctx.fillStyle = readableTextColor(entry.color);
          ctx.font = `${entry.emphasis ? 'bold ' : ''}10px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(
            `${eokText(value)} (${Math.round((value / total) * 100)}%)`,
            x + barWidth / 2,
            cursorY + segmentHeight / 2 + 3.5
          );
        }
      });

      // 막대 위 — 총액, 그 위에 위험 금액. 위험이 없으면 총액만 쓴다.
      ctx.textAlign = 'center';
      ctx.fillStyle = '#37474F';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(eokText(total), x + barWidth / 2, cursorY - 7);

      if (risk > 0 && total > 0) {
        ctx.fillStyle = '#C62828';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(
          `위험 ${eokText(risk)}억 (${Math.round((risk / total) * 100)}%)`,
          x + barWidth / 2,
          cursorY - 22
        );
      }

      // X축 라벨
      ctx.fillStyle = '#424242';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(label, x + barWidth / 2, height - 12);
    });
  }, [labels, series, height, showSegmentLabels]);

  return (
    <div className="w-full">
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {series.map((entry) => (
          <div key={entry.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span
              className={
                entry.emphasis
                  ? 'text-[11px] font-semibold text-neutral-800'
                  : 'text-[11px] text-neutral-400'
              }
            >
              {entry.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
