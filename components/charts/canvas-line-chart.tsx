'use client';

import { useEffect, useRef } from 'react';

interface Props {
  historyData: number[];   // 금년 실적
  forecastData: number[];  // 금년 예측
  lastYearData?: number[]; // 전년 동월 실적 (옵션)
  labels: string[];        // X축 라벨 (YYYY-MM-DD)
  height?: number;
}

export default function CanvasLineChart({ 
  historyData, 
  forecastData, 
  lastYearData = [], 
  labels, 
  height = 300 
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. 해상도 조정 (Retina Display 대응)
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, height);

    // 2. 설정
    const padding = 40; 
    const chartWidth = rect.width - padding * 2;
    const chartHeight = height - padding * 2;
    const totalPoints = labels.length;
    
    // 최대값 계산 (전년 데이터 포함)
    const currentValues = [...historyData, ...forecastData];
    const allValuesForMax = [...currentValues, ...lastYearData];
    // 데이터가 하나도 없을 때를 대비해 1로 설정, 여백 20%
    const maxVal = Math.max(...allValuesForMax, 1) * 1.2;
    
    // 좌표 계산 헬퍼 함수
    const getX = (idx: number) => padding + (idx / (totalPoints - 1)) * chartWidth;
    const getY = (val: number) => (height - padding) - (val / maxVal) * chartHeight;

    // 3. 배경 그리드 & 바닥선
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // 5등분 그리드
    for(let i=0; i<=5; i++) {
        const y = padding + (chartHeight * i / 5);
        ctx.moveTo(padding, y);
        ctx.lineTo(rect.width - padding, y);
    }
    ctx.stroke();

    // 4. 전년 동월 데이터 그리기 (회색 실선 & 그림자 효과)
    if (lastYearData.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#BDBDBD'; // 연한 회색
      ctx.lineWidth = 2;
      ctx.setLineDash([]); // 실선

      lastYearData.forEach((val, i) => {
        if (i >= totalPoints) return; // 라벨 길이보다 데이터가 길면 무시
        if (i === 0) ctx.moveTo(getX(i), getY(val));
        else ctx.lineTo(getX(i), getY(val));
      });
      ctx.stroke();

      // 전년 데이터 포인트 (작은 점)
      ctx.fillStyle = '#E0E0E0';
      lastYearData.forEach((val, i) => {
        if (i >= totalPoints) return;
        const x = getX(i);
        const y = getY(val);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 5. 금년 실적 그리기 (파란 실선)
    ctx.beginPath();
    ctx.strokeStyle = '#4A90E2';
    ctx.lineWidth = 2;
    ctx.setLineDash([]); 
    historyData.forEach((val, i) => {
        if (i === 0) ctx.moveTo(getX(i), getY(val));
        else ctx.lineTo(getX(i), getY(val));
    });
    ctx.stroke();

    // 6. 금년 예측 그리기 (빨간 점선)
    const startIdx = historyData.length - 1;
    if (startIdx >= 0 && forecastData.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#E53935';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]); // 점선 설정
      
      // 실적 마지막 점에서 시작
      ctx.moveTo(getX(startIdx), getY(historyData[startIdx]));
      
      forecastData.forEach((val, i) => {
          ctx.lineTo(getX(startIdx + 1 + i), getY(val));
      });
      ctx.stroke();
      ctx.setLineDash([]); // 점선 해제
    }

    // 7. 기준일(Today) 세로선
    if (historyData.length > 0) {
      const splitX = getX(historyData.length - 1);
      ctx.beginPath();
      ctx.strokeStyle = '#212121';
      ctx.lineWidth = 1;
      ctx.moveTo(splitX, padding);
      ctx.lineTo(splitX, height - padding);
      ctx.stroke();
      
      ctx.fillStyle = '#212121';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText("기준일", splitX, padding - 10);
    }

    // 8. 데이터 포인트 & 수치 라벨
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';

    // (1) 실적 값
    historyData.forEach((val, i) => {
        const x = getX(i);
        const y = getY(val);
        // 흰색 원 + 파란 테두리
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.strokeStyle = '#4A90E2'; ctx.lineWidth = 2; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
        
        ctx.fillStyle = '#1565C0';
        ctx.fillText(val.toLocaleString(), x, y - 12);
    });

    // (2) 예측 값
    forecastData.forEach((val, i) => {
        const idx = startIdx + 1 + i;
        const x = getX(idx);
        const y = getY(val);
        // 흰색 원 + 빨간 테두리
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.strokeStyle = '#E53935'; ctx.lineWidth = 2; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();

        ctx.fillStyle = '#C62828';
        ctx.fillText(val.toLocaleString(), x, y - 12);
    });

    // ✅ [복구 완료] 9. X축 날짜 라벨 그리기
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    labels.forEach((label, i) => {
        // 라벨이 겹치지 않도록 2칸 간격으로 표시 (데이터 개수에 따라 조절 가능)
        if (i % 2 === 0) { 
            // label: "2025-10-01" -> slice(2, 7) => "25-10"
            const dateText = label.length >= 7 ? label.slice(2, 7) : label;
            ctx.fillText(dateText, getX(i), height - padding + 20);
        }
    });

    // 10. 범례 (Legend) 그리기 - 좌측 상단
    const legendX = padding + 10;
    const legendY = padding + 10;
    
    // '전년동월' 범례 표시
    ctx.fillStyle = '#BDBDBD';
    ctx.fillRect(legendX, legendY, 10, 2); // 회색 선 아이콘
    ctx.fillStyle = '#757575';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText("전년동월", legendX + 15, legendY + 4);

  }, [historyData, forecastData, lastYearData, labels, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: `${height}px` }} />;
}