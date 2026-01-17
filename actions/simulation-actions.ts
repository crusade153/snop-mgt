'use server'

import { runSimulation, SimulationParams } from '@/lib/simulation-engine';

export async function executeSimulation(params: SimulationParams) {
  // 실제 환경에서는 여기서 DB의 최신 재고/비용 데이터를 가져옵니다.
  // 현재는 엔진 내부의 기준값(BASE)을 사용하여 시뮬레이션을 돌립니다.
  
  try {
    // 1. 시뮬레이션 결과 계산 (After)
    const simulatedResult = runSimulation({}, params);

    // 2. 비교를 위한 기준값 계산 (Before - 변화율 0일 때)
    const baseParams = { 
      demandChange: 0, 
      priceChange: 0, 
      costChange: 0, 
      supplyConstraint: 12000 // 기본 capa
    };
    const baseResult = runSimulation({}, baseParams);

    return {
      success: true,
      data: {
        base: baseResult,
        simulated: simulatedResult
      }
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "시뮬레이션 실행 중 오류가 발생했습니다." };
  }
}