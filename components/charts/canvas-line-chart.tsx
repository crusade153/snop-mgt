'use client';

import { useEffect, useRef } from 'react';

interface Props {
  historyData: number[]; // 과거 실적 데이터
  forecastData: number[]; // 미래 예측 데이터
  labels: string[];      // 전체 날짜 라벨
  height?: number;
}

export default function CanvasLineChart({ 
  historyData, 
  forecastData, 
  labels, 
  height = 300 
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. 해상도 조정 (선명하게)
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, height);

    // 2. 설정
    const padding = 40; // 여백 확보 (글자 안 잘리게)
    const chartWidth = rect.width - padding * 2;
    const chartHeight = height - padding * 2;
    const totalPoints = labels.length;
    
    // 데이터 병합 및 최대값 계산 (여유 20%)
    const allValues = [...historyData, ...forecastData];
    const maxVal = Math.max(...allValues, 1) * 1.2;
    
    // 좌표 계산 함수
    const getX = (idx: number) => padding + (idx / (totalPoints - 1)) * chartWidth;
    const getY = (val: number) => (height - padding) - (val / maxVal) * chartHeight;

    // 3. 그리드 & 바닥선
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let i=0; i<=5; i++) {
        const y = padding + (chartHeight * i / 5);
        ctx.moveTo(padding, y);
        ctx.lineTo(rect.width - padding, y);
    }
    ctx.stroke();

    // 4. [실적] 그리기 (History) - 파란 실선
    ctx.beginPath();
    ctx.strokeStyle = '#4A90E2';
    ctx.lineWidth = 2;
    historyData.forEach((val, i) => {
        if (i === 0) ctx.moveTo(getX(i), getY(val));
        else ctx.lineTo(getX(i), getY(val));
    });
    ctx.stroke();

    // 5. [예측] 그리기 (Forecast) - 빨간 점선
    ctx.beginPath();
    ctx.strokeStyle = '#E53935';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); 
    
    const startIdx = historyData.length - 1;
    ctx.moveTo(getX(startIdx), getY(historyData[startIdx]));
    
    forecastData.forEach((val, i) => {
        ctx.lineTo(getX(startIdx + 1 + i), getY(val));
    });
    ctx.stroke();
    ctx.setLineDash([]); 

    // 6. 기준선 (Today)
    const splitX = getX(historyData.length - 1);
    ctx.beginPath();
    ctx.strokeStyle = '#212121';
    ctx.lineWidth = 1;
    ctx.moveTo(splitX, padding);
    ctx.lineTo(splitX, height - padding);
    ctx.stroke();
    
    // 기준선 텍스트
    ctx.fillStyle = '#212121';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("기준일", splitX, padding - 10);

    // 7. 데이터 포인트 & 수치 라벨 그리기 (핵심 추가 사항)
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';

    // (1) 실적 데이터 포인트
    historyData.forEach((val, i) => {
        const x = getX(i);
        const y = getY(val);

        // 점 그리기
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = '#4A90E2';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();

        // 수치 텍스트 (파란색) - 공간이 좁으면 건너뛰거나 지그재그 배치 가능하지만, 일단 다 표시
        ctx.fillStyle = '#1565C0';
        ctx.fillText(val.toLocaleString(), x, y - 12);
    });

    // (2) 예측 데이터 포인트
    forecastData.forEach((val, i) => {
        const idx = startIdx + 1 + i;
        const x = getX(idx);
        const y = getY(val);

        // 점 그리기
        ctx.beginPath();
        ctx.fillStyle = '#fff';
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = '#E53935';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();

        // 수치 텍스트 (빨간색)
        ctx.fillStyle = '#C62828';
        ctx.fillText(val.toLocaleString(), x, y - 12);
    });

    // 8. X축 날짜 (3칸 간격)
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    labels.forEach((label, i) => {
        if (i % 2 === 0) { // 2칸 간격으로 표시 (공간 확보)
            ctx.fillText(label.slice(2, 7), getX(i), height - padding + 20); // 24-01 형태
        }
    });

  }, [historyData, forecastData, labels, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px` }} />;
}