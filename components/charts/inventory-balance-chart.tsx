'use client';

import { useEffect, useRef } from 'react';

interface Props {
  timeline: { date: string; balance: number }[];
  height?: number;
}

export default function InventoryBalanceChart({ timeline, height = 250 }: Props) {
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

    const padding = 40;
    const chartWidth = rect.width - padding * 2;
    const chartHeight = height - padding * 2;

    if (timeline.length === 0) return;

    // Y축 범위 설정 (음수 포함)
    const maxVal = Math.max(...timeline.map(d => d.balance), 100) * 1.2;
    const minVal = Math.min(...timeline.map(d => d.balance), 0) * 1.2;
    const range = maxVal - minVal;

    const getX = (idx: number) => padding + (idx / (timeline.length - 1)) * chartWidth;
    const getY = (val: number) => padding + chartHeight - ((val - minVal) / range) * chartHeight;

    // 0점 기준선 (빨간색)
    const zeroY = getY(0);
    ctx.beginPath();
    ctx.strokeStyle = '#E53935';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padding, zeroY);
    ctx.lineTo(rect.width - padding, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 재고 흐름선
    ctx.beginPath();
    ctx.strokeStyle = '#2E7D32'; // Green
    ctx.lineWidth = 2;
    
    timeline.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(getX(i), getY(pt.balance));
      else ctx.lineTo(getX(i), getY(pt.balance));
    });
    ctx.stroke();

    // 0 이하 영역 채우기 (위험 구간)
    ctx.lineTo(getX(timeline.length - 1), zeroY);
    ctx.lineTo(getX(0), zeroY);
    ctx.fillStyle = 'rgba(229, 57, 53, 0.1)'; // 연한 빨강
    ctx.fill();

    // 포인트 그리기
    timeline.forEach((pt, i) => {
      const x = getX(i);
      const y = getY(pt.balance);
      
      // 값이 0보다 작으면 빨간점, 아니면 초록점
      ctx.fillStyle = pt.balance < 0 ? '#E53935' : '#2E7D32';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      // 날짜 라벨 (듬성듬성)
      if (i % Math.ceil(timeline.length / 5) === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(pt.date.slice(5), x, height - 10);
      }
    });

  }, [timeline, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px` }} />;
}