import type { MaterialInsight, MaterialStockStatus } from '@/types/material';

export const MIN_SIMULATION_MONTHS = 3;
export const MAX_SIMULATION_MONTHS = 12;

export interface MaterialSimulationSettings {
  /** 최근 사용 이력을 인정할 기간(N) */
  usageMonths: number;
  /** 현재고와 비교할 향후 예상 소요 기간(M) */
  excessMonths: number;
}

export interface MaterialStatusResult {
  status: MaterialStockStatus;
  usage: number;
  monthlyUse: number;
  expectedUse: number;
  stockMonths: number | null;
  statusQuantity: number;
  statusValue: number;
  reason: string;
}

export function clampSimulationMonths(value: number): number {
  if (!Number.isFinite(value)) return MIN_SIMULATION_MONTHS;
  return Math.min(MAX_SIMULATION_MONTHS, Math.max(MIN_SIMULATION_MONTHS, Math.round(value)));
}

/**
 * 네 상태는 반드시 하나만 반환한다. 우선순위는 불용 → 부진 → 과잉 → 정상이다.
 * 품질검사재고(INSME)는 합격 후 사용될 수 있어 불용으로 단정하지 않는다.
 */
export function classifyMaterialInventory(
  insight: MaterialInsight,
  settings: MaterialSimulationSettings,
): MaterialStatusResult {
  const usageMonths = clampSimulationMonths(settings.usageMonths);
  const excessMonths = clampSimulationMonths(settings.excessMonths);
  const usage = Math.max(0, insight.requirementsByMonths[usageMonths] ?? 0);
  const activeProducts = Math.max(0, insight.activeProductCountsByMonths[usageMonths] ?? 0);
  const monthlyUse = usage / usageMonths;
  const expectedUse = monthlyUse * excessMonths;
  const stockMonths = monthlyUse > 0 ? insight.onHand / monthlyUse : null;
  const totalHeldQty = insight.onHand + insight.qualityStock + insight.blockedStock;

  if (!insight.bomRegistered) {
    return {
      status: 'OBSOLETE',
      usage,
      monthlyUse,
      expectedUse,
      stockMonths,
      statusQuantity: totalHeldQty,
      statusValue: totalHeldQty * insight.unitPrice,
      reason: '현재 BOM에 등록되지 않은 자재입니다.',
    };
  }

  // 보류재고만 있고 가용·품질검사 재고가 없으면 현재 사용할 수 없는 재고로 본다.
  if (insight.onHand <= 0 && insight.qualityStock <= 0 && insight.blockedStock > 0) {
    return {
      status: 'OBSOLETE',
      usage,
      monthlyUse,
      expectedUse,
      stockMonths,
      statusQuantity: insight.blockedStock,
      statusValue: insight.blockedStock * insight.unitPrice,
      reason: '가용재고 없이 SAP 보류재고만 남아 있습니다.',
    };
  }

  if (activeProducts <= 0) {
    return {
      status: 'SLOW_MOVING',
      usage,
      monthlyUse,
      expectedUse,
      stockMonths,
      statusQuantity: insight.onHand,
      statusValue: insight.stockValue,
      reason: `최근 ${usageMonths}개월간 연결 완제품의 생산 이력이 없습니다.`,
    };
  }

  if (monthlyUse > 0 && insight.onHand > expectedUse) {
    return {
      status: 'EXCESS',
      usage,
      monthlyUse,
      expectedUse,
      stockMonths,
      statusQuantity: insight.onHand,
      statusValue: insight.stockValue,
      reason: `가용재고가 향후 ${excessMonths}개월 예상 소요량보다 많습니다.`,
    };
  }

  return {
    status: 'ACTIVE',
    usage,
    monthlyUse,
    expectedUse,
    stockMonths,
    statusQuantity: insight.onHand,
    statusValue: insight.stockValue,
    reason:
      monthlyUse > 0
        ? `최근 ${usageMonths}개월 사용 이력이 있고 재고가 ${excessMonths}개월 예상 소요 이내입니다.`
        : '사용 이력은 있으나 BOM 단위 경고로 예상 소요량을 계산할 수 없습니다.',
  };
}

export function describeMaterialStatuses(settings: MaterialSimulationSettings): Record<
  MaterialStockStatus,
  { label: string; formula: string; detail: string }
> {
  const usageMonths = clampSimulationMonths(settings.usageMonths);
  const excessMonths = clampSimulationMonths(settings.excessMonths);
  return {
    ACTIVE: {
      label: '정상재고',
      formula: `BOM 등록 + 최근 ${usageMonths}개월 사용 + 현재고 ≤ ${excessMonths}개월 예상 소요`,
      detail: '최근 사용이 확인되고, 가용재고가 선택한 향후 소요 범위 안에 있는 품목입니다.',
    },
    EXCESS: {
      label: '과잉재고',
      formula: `BOM 등록 + 최근 ${usageMonths}개월 사용 + 현재고 > ${excessMonths}개월 예상 소요`,
      detail: `예상 소요는 최근 ${usageMonths}개월 BOM 환산 소요의 월평균 × ${excessMonths}개월입니다.`,
    },
    SLOW_MOVING: {
      label: '부진재고',
      formula: `BOM 등록 + 최근 ${usageMonths}개월 사용 이력 없음`,
      detail: '연결 완제품의 생산실적이 선택한 기간 동안 한 건도 없는 품목입니다.',
    },
    OBSOLETE: {
      label: '불용재고',
      formula: 'BOM 미등록 또는 가용·품질재고 없이 SAP 보류재고만 존재',
      detail:
        'BOM에서 빠진 자재와 현재 사용할 수 없는 보류재고를 분류합니다. 품질검사재고는 불용으로 단정하지 않고 별도 표시합니다.',
    },
  };
}
