'use client';

import { useEffect, useRef } from 'react';

interface Props {
  months: string[];              // X축 라벨 ('YYYY-MM')
  actual: (number | null)[];     // 실제 매출 (미래는 null)
  predicted: (number | null)[];  // ML 예측
  splitLabel?: string;           // 실적/예측 경계 라벨
  height?: number;
}

/**
 * 실제 매출(파란 실선) vs ML 예측(빨간 점선)을 같은 월 축 위에 겹쳐 그린다.
 */
export default function CanvasCompareChart({
  months,
  actual,
  predicted,
  splitLabel = '현재',
  height = 320,
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

    const padding = 44;
    const chartWidth = rect.width - padding * 2;
    const chartHeight = height - padding * 2;
    const totalPoints = months.length;
    if (totalPoints === 0) return;

    const allVals = [...actual, ...predicted].filter((v): v is number => v !== null && Number.isFinite(v));
    const maxVal = Math.max(...allVals, 1) * 1.2;

    const getX = (idx: number) => padding + (totalPoints === 1 ? chartWidth / 2 : (idx / (totalPoints - 1)) * chartWidth);
    const getY = (val: number) => (height - padding) - (val / maxVal) * chartHeight;

    // 그리드
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight * i) / 5;
      ctx.moveTo(padding, y);
      ctx.lineTo(rect.width - padding, y);
    }
    ctx.stroke();

    // 경계선: 마지막 실적 지점
    let lastActualIdx = -1;
    for (let i = actual.length - 1; i >= 0; i--) {
      if (actual[i] !== null) { lastActualIdx = i; break; }
    }
    if (lastActualIdx >= 0 && lastActualIdx < totalPoints) {
      const splitX = getX(lastActualIdx);
      ctx.beginPath();
      ctx.strokeStyle = '#9E9E9E';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.moveTo(splitX, padding);
      ctx.lineTo(splitX, height - padding);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#757575';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(splitLabel, splitX, padding - 8);
    }

    // 라인 그리기 헬퍼 (null 구간은 끊음)
    const drawLine = (data: (number | null)[], color: string, dashed: boolean) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      let started = false;
      data.forEach((val, i) => {
        if (val === null) { started = false; return; }
        const x = getX(i);
        const y = getY(val);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // 예측(빨간 점선) 먼저, 실제(파란 실선) 위에
    drawLine(predicted, '#E53935', true);
    drawLine(actual, '#1E88E5', false);

    // 포인트
    const drawPoints = (data: (number | null)[], color: string) => {
      data.forEach((val, i) => {
        if (val === null) return;
        const x = getX(i);
        const y = getY(val);
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.stroke();
      });
    };
    drawPoints(predicted, '#E53935');
    drawPoints(actual, '#1E88E5');

    // X축 라벨 (겹침 방지: 간격 조절)
    const step = Math.max(1, Math.ceil(totalPoints / 8));
    ctx.fillStyle = '#999';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    months.forEach((label, i) => {
      if (i % step === 0) {
        const t = label.length >= 7 ? label.slice(2) : label; // '2025-10' -> '25-10'
        ctx.fillText(t, getX(i), height - padding + 18);
      }
    });

    // 범례
    const lx = padding + 6;
    const ly = padding + 8;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1E88E5'; ctx.fillRect(lx, ly, 12, 3);
    ctx.fillStyle = '#555'; ctx.font = '10px sans-serif';
    ctx.fillText('실제 매출', lx + 18, ly + 4);
    ctx.fillStyle = '#E53935'; ctx.fillRect(lx + 78, ly, 12, 3);
    ctx.fillStyle = '#555';
    ctx.fillText('ML 예측', lx + 96, ly + 4);
  }, [months, actual, predicted, splitLabel, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px` }} />;
}
