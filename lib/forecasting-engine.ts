// lib/forecasting-engine.ts

export type ForecastMethod = 'Linear Regression (Trend)';

interface DataPoint {
  date: string;
  value: number;
}

export interface ForecastResult {
  method: ForecastMethod;
  historical: DataPoint[]; // 금년 실적 (최근 6개월)
  forecast: DataPoint[];   // 금년 예측 (향후 6개월)
  lastYear: DataPoint[];   // ✅ [추가] 전년 동월 실적 (12개월 치)
  metrics: {
    accuracy: number;
    volatility: number;
  };
  trend: 'UP' | 'DOWN' | 'STABLE';
  changeRate: number;
}

// 📐 선형 회귀 (Linear Regression) 알고리즘
function calculateLinearForecast(values: number[], horizon: number): number[] {
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

  for (let x = 0; x < n; x++) {
    const y = values[x];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;

  const forecast: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const nextX = n + i; 
    let nextVal = slope * nextX + intercept;
    forecast.push(Math.max(0, Math.round(nextVal)));
  }

  return forecast;
}

// 변동성 계산
function calculateVolatility(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export async function generateForecast(
  historyData: DataPoint[], 
  lastYearData: DataPoint[], // ✅ [추가] 전년 데이터 인자 받기
  horizon: number = 6
): Promise<ForecastResult> {
  
  // 데이터가 없으면 빈 값 반환
  if (!historyData || historyData.length === 0) {
    return {
      method: 'Linear Regression (Trend)',
      historical: [], forecast: [], lastYear: [],
      metrics: { accuracy: 0, volatility: 0 },
      trend: 'STABLE', changeRate: 0
    };
  }

  const values = historyData.map(d => d.value);
  
  // 1. 미래 예측 (선형 회귀)
  let forecastValues: number[] = [];
  if (values.length < 2) {
    const avg = values[0] || 0;
    forecastValues = Array(horizon).fill(avg);
  } else {
    forecastValues = calculateLinearForecast(values, horizon);
  }

  // 날짜 매핑
  const lastDate = new Date(historyData[historyData.length - 1].date);
  const futurePoints: DataPoint[] = forecastValues.map((val, i) => {
    const d = new Date(lastDate);
    d.setMonth(d.getMonth() + i + 1);
    return {
      date: d.toISOString().split('T')[0],
      value: val
    };
  });

  // 2. 트렌드 분석
  const historyAvg = values.reduce((a, b) => a + b, 0) / values.length;
  const forecastAvg = forecastValues.reduce((a, b) => a + b, 0) / forecastValues.length;
  const changeRate = historyAvg === 0 ? 0 : ((forecastAvg - historyAvg) / historyAvg) * 100;
  
  let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
  if (changeRate > 3) trend = 'UP';
  else if (changeRate < -3) trend = 'DOWN';

  // 3. 신뢰도 지표
  const volatility = calculateVolatility(values);
  const accuracy = Math.max(0, 100 - ((volatility / (historyAvg || 1)) * 100));

  return {
    method: 'Linear Regression (Trend)',
    historical: historyData,
    forecast: futurePoints,
    lastYear: lastYearData, // ✅ 그대로 전달
    metrics: {
      accuracy: Math.round(accuracy),
      volatility: Math.round(volatility)
    },
    trend,
    changeRate
  };
}