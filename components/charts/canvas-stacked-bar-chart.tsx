'use client';

import { useEffect, useRef } from 'react';

interface Series {
  label: string;
  color: string;
  /** 카테고리별 값 (억원) */
  values: number[];
}

interface Props {
  /** X축 라벨 (카테고리) */
  labels: string[];
  series: Series[];
  height?: number;
  /** 각 조각 안에 값·비중을 쓸지. 조각이 얇으면 자동으로 생략된다 */
  showSegmentLabels?: boolean;
}

/**
 * 카테고리별 누적 막대 — 원본 주간 엑셀의 「카테고리별 소비기한별 재고금액」 차트.
 *
 * 별도 데이터 소스가 없다. 메인 표의 구간별 재고금액을 억원으로 접어 그대로 쌓는다.
 * 외부 차트 라이브러리 없이 canvas 로 직접 그리는 이 저장소 관례를 따른다.
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

    const paddingLeft = 44;
    const paddingRight = 12;
    const paddingTop = 24;
    const paddingBottom = 34;
    const chartWidth = rect.width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    if (chartWidth <= 0 || chartHeight <= 0) return;

    const totals = labels.map((_, index) =>
      series.reduce((sum, entry) => sum + (entry.values[index] || 0), 0)
    );
    const max = Math.max(...totals, 1);
    // 눈금이 정수로 떨어지도록 위쪽을 살짝 올린다
    const axisMax = Math.ceil(max * 1.1);
    const scale = chartHeight / axisMax;

    // Y축 눈금
    ctx.strokeStyle = '#EEEEEE';
    ctx.fillStyle = '#9E9E9E';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    const tickCount = 5;
    for (let index = 0; index <= tickCount; index += 1) {
      const value = (axisMax / tickCount) * index;
      const y = paddingTop + chartHeight - value * scale;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + chartWidth, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(value)), paddingLeft - 8, y + 4);
    }

    const slotWidth = chartWidth / labels.length;
    const barWidth = Math.min(slotWidth * 0.55, 64);

    labels.forEach((label, index) => {
      const x = paddingLeft + slotWidth * index + (slotWidth - barWidth) / 2;
      let cursorY = paddingTop + chartHeight;
      const total = totals[index];

      series.forEach((entry) => {
        const value = entry.values[index] || 0;
        if (value <= 0) return;
        const segmentHeight = value * scale;
        cursorY -= segmentHeight;

        ctx.fillStyle = entry.color;
        ctx.fillRect(x, cursorY, barWidth, segmentHeight);

        // 조각이 너무 얇으면 글자가 겹치므로 생략한다
        if (showSegmentLabels && segmentHeight >= 16 && total > 0) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            `${Math.round(value)} (${Math.round((value / total) * 100)}%)`,
            x + barWidth / 2,
            cursorY + segmentHeight / 2 + 3
          );
        }
      });

      // 막대 위 합계
      ctx.fillStyle = '#424242';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.round(total)), x + barWidth / 2, cursorY - 6);

      // X축 라벨
      ctx.fillStyle = '#616161';
      ctx.font = '12px sans-serif';
      ctx.fillText(label, x + barWidth / 2, height - 12);
    });
  }, [labels, series, height, showSegmentLabels]);

  return (
    <div className="w-full">
      <canvas ref={canvasRef} style={{ width: '100%', height }} />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {series.map((entry) => (
          <div key={entry.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[11px] text-neutral-600">{entry.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
