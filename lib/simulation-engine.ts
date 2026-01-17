// lib/simulation-engine.ts

// 입력값: 선택한 제품의 정보와 시뮬레이션 파라미터
export interface SimulationParams {
  productName: string;
  currentStock: number;    // 현재 재고
  productionPlan: number;  // 예정된 생산량 (다음달)
  avgMonthlySales: number; // 월 평균 판매량 (기준 수요)
  salesIncreasePct: number; // 판매 증가 시나리오 (%)
}

export interface SimulationResult {
  scenario: {
    targetDemand: number;    // 예상되는 수요 (증가분 포함)
    totalSupply: number;     // 가용 총량 (재고 + 생산)
    gap: number;             // 과부족 (공급 - 수요)
  };
  status: 'SAFE' | 'WARNING' | 'DANGER'; // 상태 판정
  coverage: number;          // 재고 방어율 (%)
  insight: string;           // AI 조언
}

export function runInventorySimulation(params: SimulationParams): SimulationResult {
  const { currentStock, productionPlan, avgMonthlySales, salesIncreasePct } = params;

  // 1. 시나리오 수요 계산 (기존 판매량 + 증가분)
  const increasedSales = avgMonthlySales * (1 + salesIncreasePct / 100);
  const targetDemand = Math.round(increasedSales);

  // 2. 가용 공급량 (현재 재고 + 생산 예정)
  const totalSupply = currentStock + productionPlan;

  // 3. 과부족 계산
  const gap = totalSupply - targetDemand;
  
  // 4. 재고 방어율 (몇 %까지 커버 가능한지)
  const coverage = (totalSupply / targetDemand) * 100;

  // 5. 상태 판정 및 조언
  let status: 'SAFE' | 'WARNING' | 'DANGER' = 'SAFE';
  let insight = '';

  if (coverage >= 120) {
    status = 'SAFE';
    insight = `✅ 충분합니다! 판매량이 ${salesIncreasePct}% 늘어도 재고가 여유롭습니다. 추가 마케팅을 진행해도 좋습니다.`;
  } else if (coverage >= 100) {
    status = 'WARNING';
    insight = `⚠️ 빠듯합니다. 수요는 맞출 수 있지만 안전재고가 거의 남지 않습니다. 생산 일정을 조금 앞당기는 것을 추천합니다.`;
  } else {
    status = 'DANGER';
    const shortage = Math.abs(gap).toLocaleString();
    insight = `🚨 비상입니다! 현재 재고와 생산 계획으로는 ${shortage}개가 부족하여 결품(OOS)이 발생합니다. 생산량을 긴급히 늘려야 합니다.`;
  }

  return {
    scenario: { targetDemand, totalSupply, gap },
    status,
    coverage,
    insight
  };
}