'use client';

import { useEffect, useRef } from 'react';

interface Props {
  data: number[];      // [Before 값, After 값]
  labels: string[];    // ["현재", "시뮬레이션"]
  colors?: string[];   // 색상 배열
  height?: number;
  unit?: string;       // 단위 (예: '원', '%')
}

export default function CanvasBarChart({ 
  data, 
  labels, 
  colors = ['#9E9E9E', '#4A90E2'], 
  height = 200,
  unit = ''
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina Display 대응 (고해상도)
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 초기화
    ctx.clearRect(0, 0, rect.width, height);

    const padding = 40;
    const chartWidth = rect.width - padding * 2;
    const chartHeight = height - padding * 2;
    
    // 데이터가 없거나 0일 경우를 대비한 방어 코드
    const maxDataVal = Math.max(...data);
    const maxVal = maxDataVal === 0 ? 100 : maxDataVal * 1.2; 
    const barWidth = chartWidth / data.length / 2; 

    data.forEach((val, index) => {
      // 막대 위치 및 높이 계산
      const x = padding + (index * (chartWidth / data.length)) + (chartWidth / data.length / 2) - (barWidth / 2);
      const barHeight = (val / maxVal) * chartHeight;
      const y = height - padding - barHeight;

      // 막대 그리기
      ctx.fillStyle = colors[index % colors.length];
      
      // 둥근 모서리 (브라우저 호환성 체크)
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barWidth, barHeight);
      }

      // 값 텍스트 (막대 위)
      ctx.fillStyle = '#333';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      
      // 값이 0이면 표시 안 하거나, 위치 조정
      const textY = y - 8;
      ctx.fillText(val.toLocaleString() + unit, x + barWidth / 2, textY);

      // 라벨 텍스트 (바닥)
      ctx.fillStyle = '#666';
      ctx.font = '12px sans-serif';
      ctx.fillText(labels[index], x + barWidth / 2, height - padding + 20);
    });

    // 바닥선 그리기
    ctx.beginPath();
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(rect.width - padding, height - padding);
    ctx.stroke();

  }, [data, labels, colors, height, unit]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px` }} />;
}