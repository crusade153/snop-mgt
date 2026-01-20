'use client';

import { useEffect, useRef } from 'react';

// 타임라인 데이터 타입 정의 (type 필드 추가)
interface TimelineEvent {
  date: string;
  balance: number;
  type?: 'STOCK' | 'PRODUCTION' | 'EXISTING_ORDER' | 'NEW_REQUEST';
  qty?: number;
}

interface Props {
  timeline: TimelineEvent[];
  height?: number;
}

export default function InventoryBalanceChart({ timeline, height = 250 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. 해상도 보정
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, height);

    const padding = { top: 40, bottom: 30, left: 40, right: 40 };
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    if (timeline.length === 0) return;

    // 2. 스케일 계산
    const balances = timeline.map(d => d.balance);
    const maxVal = Math.max(...balances, 100) * 1.2;
    const minVal = Math.min(...balances, 0) * 1.2; // 음수 영역 확보
    const range = maxVal - minVal;

    const getX = (idx: number) => padding.left + (idx / (timeline.length - 1)) * chartWidth;
    const getY = (val: number) => padding.top + chartHeight - ((val - minVal) / (range || 1)) * chartHeight;

    // 3. 0점 기준선 (빨간 점선)
    const zeroY = getY(0);
    ctx.beginPath();
    ctx.strokeStyle = '#EF9A9A'; // 연한 빨강
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(rect.width - padding.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. 재고 흐름선 (Line)
    ctx.beginPath();
    ctx.strokeStyle = '#90A4AE'; // 기본 회색선
    ctx.lineWidth = 2;
    
    timeline.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(getX(i), getY(pt.balance));
      else ctx.lineTo(getX(i), getY(pt.balance));
    });
    ctx.stroke();

    // 5. 영역 채우기 (결품 구간 강조)
    ctx.lineTo(getX(timeline.length - 1), zeroY);
    ctx.lineTo(getX(0), zeroY);
    ctx.fillStyle = 'rgba(229, 57, 53, 0.05)'; // 아주 연한 붉은색
    ctx.fill();

    // 6. 데이터 포인트 (이벤트별 색상 구분)
    timeline.forEach((pt, i) => {
      const x = getX(i);
      const y = getY(pt.balance);
      
      let color = '#B0BEC5'; // 기본 (STOCK)
      let radius = 3;

      // 이벤트 타입에 따른 색상 분기
      if (pt.type === 'PRODUCTION') {
        color = '#1565C0'; // 파랑 (생산)
        radius = 4;
      } else if (pt.type === 'EXISTING_ORDER') {
        color = '#EF6C00'; // 주황 (기수요)
        radius = 4;
      } else if (pt.type === 'NEW_REQUEST') {
        color = '#2E7D32'; // 초록 (신규)
        radius = 5;
      } else if (pt.balance < 0) {
        color = '#C62828'; // 빨강 (결품 상태)
        radius = 4;
      }

      // 점 그리기
      ctx.beginPath();
      ctx.fillStyle = '#fff';
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, radius - 1, 0, Math.PI * 2); // 테두리 느낌을 위해 내부 채움
      ctx.fill();
      
      // 외곽선 강조
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();

      // 7. 텍스트 라벨 (날짜 & 이벤트)
      // 공간 확보를 위해 듬성듬성 찍거나, 중요 이벤트(생산/주문)는 무조건 표시
      const isImportant = pt.type && pt.type !== 'STOCK';
      const isSparse = i % Math.ceil(timeline.length / 6) === 0;

      if (isImportant || isSparse) {
        ctx.fillStyle = isImportant ? '#455A64' : '#90A4AE';
        ctx.font = isImportant ? 'bold 10px sans-serif' : '10px sans-serif';
        ctx.textAlign = 'center';
        
        // 날짜 (MM-DD)
        ctx.fillText(pt.date.slice(5), x, height - 10);

        // 수량 표시 (이벤트가 있는 경우 위에 표시)
        if (isImportant && pt.qty) {
           const sign = pt.type === 'PRODUCTION' ? '+' : '-';
           ctx.fillStyle = color;
           ctx.fillText(`${sign}${Math.abs(pt.qty).toLocaleString()}`, x, y - 10);
        }
      }
    });

    // 8. 범례 (Legend) 그리기 - 상단 우측
    const legendX = rect.width - padding.right - 200;
    const legendY = 20;
    
    const drawLegendItem = (label: string, color: string, offsetX: number) => {
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(legendX + offsetX, legendY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#546E7A';
        ctx.textAlign = 'left';
        ctx.fillText(label, legendX + offsetX + 8, legendY + 3);
    };

    drawLegendItem("생산입고", "#1565C0", 0);
    drawLegendItem("기수요", "#EF6C00", 60);
    drawLegendItem("신규요청", "#2E7D32", 110);

  }, [timeline, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px` }} />;
}