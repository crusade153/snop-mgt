// lib/forecasting-engine.ts

export type ForecastMethod = 'Linear Regression (Trend)';

interface DataPoint {
  date: string;
  value: number;
}

export interface ForecastResult {
  method: ForecastMethod;
  historical: DataPoint[];
  forecast: DataPoint[];
  metrics: {
    accuracy: number;
    volatility: number;
  };
  trend: 'UP' | 'DOWN' | 'STABLE';
  changeRate: number;
}

// 📐 선형 회귀 (Linear Regression) 알고리즘
// 데이터를 가장 잘 설명하는 직선(y = ax + b)을 찾습니다.
function calculateLinearForecast(values: number[], horizon: number): number[] {
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

  // x는 시간(0, 1, 2...), y는 판매량
  for (let x = 0; x < n; x++) {
    const y = values[x];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  // 기울기(slope)와 절편(intercept) 공식
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;

  // 미래 예측값 생성
  const forecast: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const nextX = n + i; // 다음 달 시점
    let nextVal = slope * nextX + intercept;
    
    // 판매량이 음수가 될 수는 없으므로 0 처리
    forecast.push(Math.max(0, Math.round(nextVal)));
  }

  return forecast;
}

// 변동성 계산 (표준편차)
function calculateVolatility(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export async function generateForecast(
  historyData: DataPoint[], 
  horizon: number = 6
): Promise<ForecastResult> {
  // 데이터가 없으면 빈 값 반환
  if (!historyData || historyData.length === 0) {
    return {
      method: 'Linear Regression (Trend)',
      historical: [], forecast: [],
      metrics: { accuracy: 0, volatility: 0 },
      trend: 'STABLE', changeRate: 0
    };
  }

  const values = historyData.map(d => d.value);
  
  // 1. 미래 예측 (선형 회귀 적용)
  // 데이터가 너무 적으면(2개 미만) 그냥 평균으로 처리
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
  // 최근 실적 평균 vs 향후 6개월 예측 평균 비교
  const historyAvg = values.reduce((a, b) => a + b, 0) / values.length;
  const forecastAvg = forecastValues.reduce((a, b) => a + b, 0) / forecastValues.length;
  
  const changeRate = historyAvg === 0 ? 0 : ((forecastAvg - historyAvg) / historyAvg) * 100;
  
  let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
  if (changeRate > 3) trend = 'UP';
  else if (changeRate < -3) trend = 'DOWN';

  // 3. 지표 계산
  const volatility = calculateVolatility(values);
  // 변동성이 너무 크면 예측 정확도 점수를 낮춤
  const accuracy = Math.max(0, 100 - ((volatility / (historyAvg || 1)) * 100));

  return {
    method: 'Linear Regression (Trend)',
    historical: historyData,
    forecast: futurePoints,
    metrics: {
      accuracy: Math.round(accuracy),
      volatility: Math.round(volatility)
    },
    trend,
    changeRate
  };
}