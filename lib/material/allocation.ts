/**
 * 귀속 엔진 — 자재 금액에 담당자 이름표를 단다
 *
 * 이 앱의 문제의식은 "자재에 주인이 없다"였다. 원부포장재는 영업계획에 따라
 * 움직이는데, 과다발주되거나 사장(死藏)돼도 그 브랜드 담당자에게는 아무 일도
 * 일어나지 않았다. 여기서 그 연결을 만든다.
 *
 * 입력은 (자재 × 공장 × 제품계층) 으로 이미 접힌 소요량 집계다. 원·부자재까지
 * 넓히면 완제품 단위 리프가 5만행이 넘어 그대로는 못 다루기 때문이다
 * (lib/material/requirement-sql.ts 참고).
 *
 * ⚠️ I/O 없는 순수 함수만 둔다. 이 저장소에는 테스트 프레임워크가 없어서
 *    순수 함수 + scripts/verify-bom-mart.mjs 가 유일한 검증 수단이다
 *    (purchase/lib/engine.ts 의 buildSupplyData 관례).
 */

import {
  UNASSIGNED_OWNER_ID,
  UNASSIGNED_OWNER_NAME,
  type MaterialFact,
  type MaterialInsight,
  type MaterialRequirementRow,
  type MaterialRiskKind,
  type OwnerShare,
  type ProductOwner,
} from '@/types/material';

export interface AllocationThresholds {
  /** 소요 집계 기간(개월). 월평균소요 = 기간합 / 이 값 */
  usageLookbackMonths: number;
  /** 재고월수가 이 값을 넘으면 과잉 */
  excessMonths: number;
  /** 재고월수가 이 값을 넘으면 심각 */
  severeMonths: number;
  /** 완제품 1개당 소요량이 이 값을 넘으면 BOM 검토 대상으로 표시 */
  suspectQtyPerFg: number;
}

export const DEFAULT_THRESHOLDS: AllocationThresholds = {
  usageLookbackMonths: 3,
  excessMonths: 3,
  severeMonths: 6,
  suspectQtyPerFg: 10,
};

/**
 * 위험 판정 기준을 실제 숫자로 풀어 쓴다. 화면에 그대로 노출해서
 * "이게 왜 위험으로 잡혔나"를 임계값과 기간까지 보고 판단할 수 있게 한다.
 */
export function describeRiskCriteria(thresholds: AllocationThresholds): Record<
  MaterialRiskKind,
  { label: string; formula: string; detail: string }
> {
  const { usageLookbackMonths: n, excessMonths, severeMonths } = thresholds;
  return {
    DISCONTINUED_ONLY: {
      label: '단종 전용',
      formula: `최근 ${n}개월 생산실적 0 (전 공장) + 재고 또는 미입고 발주 > 0`,
      detail:
        `이 자재를 쓰는 완제품이 ${n}개월간 전 공장 어디에서도 한 번도 생산되지 않았습니다. ` +
        `제품이 단종·리뉴얼되면서 남은 자재로, 사실상 폐기 후보입니다.`,
    },
    DEAD: {
      label: '사장 재고',
      formula: `해당 공장 최근 ${n}개월 소요량 0 + 재고 > 0 (단, 다른 공장에서는 생산 중)`,
      detail:
        `이 공장에서는 ${n}개월간 이 자재가 전혀 안 나갔는데 재고가 남아 있습니다. ` +
        `생산이 다른 공장으로 옮겨갔을 수 있으니 이관·전용을 검토할 대상입니다.`,
    },
    EXCESS: {
      label: '과잉',
      formula: `재고월수 = 현재고 ÷ 월평균소요 > ${excessMonths}개월 (${severeMonths}개월 초과는 심각)`,
      detail:
        `월평균소요 = 최근 ${n}개월 소요량 ÷ ${n}. ` +
        `소요량 = Σ(완제품 생산실적 × 완제품 1개당 BOM 소요량)으로 계산합니다.`,
    },
    OVER_ORDERED: {
      label: '과다 발주',
      formula: `(현재고 + 미입고 발주잔량) ÷ 월평균소요 > ${excessMonths}개월`,
      detail:
        `미입고 발주 = 발주수량 > 입고수량인 건. 납기가 30일 넘게 지난 건은 미정리로 보고 제외합니다. ` +
        `신제품은 실적이 짧아 월평균소요가 작게 잡히므로 과다로 보일 수 있습니다.`,
    },
  };
}

export interface AllocationInput {
  requirements: MaterialRequirementRow[];
  facts: MaterialFact[];
  owners: ProductOwner[];
  thresholds?: Partial<AllocationThresholds>;
}

type ResolvedOwner = { ownerId: string; ownerName: string; ownerTeam: string | null };

const UNASSIGNED: ResolvedOwner = {
  ownerId: UNASSIGNED_OWNER_ID,
  ownerName: UNASSIGNED_OWNER_NAME,
  ownerTeam: null,
};

/**
 * 제품계층 → 담당자. 가장 구체적인 매핑이 이긴다: 제품군 > 카테고리 > 브랜드.
 * 매칭이 없으면 '(담당 미지정)' 으로 모은다 — 조용히 버리면 "주인 없음"이 그대로 남는다.
 */
export function createOwnerResolver(owners: ProductOwner[]) {
  const index = new Map<string, ResolvedOwner>();
  // PRIMARY 가 BACKUP 을 덮어쓰도록 BACKUP 을 먼저 넣는다.
  const ordered = [...owners].sort(
    (a, b) => (a.role === 'PRIMARY' ? 1 : 0) - (b.role === 'PRIMARY' ? 1 : 0),
  );
  for (const owner of ordered) {
    if (!owner.scopeKey) continue;
    index.set(`${owner.scopeType}|${owner.scopeKey}`, {
      ownerId: owner.ownerId,
      ownerName: owner.ownerName,
      ownerTeam: owner.ownerTeam,
    });
  }

  return function resolveOwner(row: {
    rootFamily: string;
    rootCategory: string;
    rootBrand: string;
  }): ResolvedOwner {
    return (
      index.get(`FAMILY|${row.rootFamily}`) ??
      index.get(`CATEGORY|${row.rootCategory}`) ??
      index.get(`BRAND|${row.rootBrand}`) ??
      UNASSIGNED
    );
  };
}

const keyOf = (werks: string, code: string) => `${werks}|${code}`;

/**
 * 소요량 계산에서 빠진 이유. 있으면 화면에 경고 뱃지로 뜬다.
 * 조용히 빼면 "왜 이 자재가 안 보이냐"가 되고, 그대로 쓰면 숫자가 틀린다.
 */
function collectWarnings(row: MaterialRequirementRow, suspectQtyPerFg: number): string[] {
  const warnings: string[] = [];
  if (row.hasFixedQty) warnings.push('로트 고정수량(FMENG) — 완제품 1개당 환산 불가');
  if (row.hasBadQty) warnings.push('BOM 수량 파싱 불가');
  if (row.suspectLotBasis) warnings.push('기준수량(BMENG) 오등록 의심 — 로트 기준으로 등록됨');
  if (row.uomMismatch) warnings.push(`단위 불일치 (BOM ${row.bomUom} ≠ 마스터 ${row.baseUom})`);
  if (row.maxQtyPerFg > suspectQtyPerFg) {
    warnings.push(`완제품 1개당 소요 ${row.maxQtyPerFg.toFixed(1)} — BOM 검토 필요`);
  }
  return warnings;
}

export interface AllocationResult {
  insights: MaterialInsight[];
  /** 담당 미지정으로 남은 제품계층. 관리자 화면에서 매핑을 채우게 한다. */
  unassignedScopes: { family: string; category: string; brand: string; productCount: number }[];
}

export function allocateMaterials(input: AllocationInput): AllocationResult {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const resolveOwner = createOwnerResolver(input.owners);
  const factByKey = new Map(input.facts.map((fact) => [keyOf(fact.werks, fact.materialCode), fact]));

  const byMaterial = new Map<string, MaterialRequirementRow[]>();
  for (const row of input.requirements) {
    const id = keyOf(row.werks, row.materialCode);
    const bucket = byMaterial.get(id);
    if (bucket) bucket.push(row);
    else byMaterial.set(id, [row]);
  }

  const unassigned = new Map<
    string,
    { family: string; category: string; brand: string; productCount: number }
  >();
  const insights: MaterialInsight[] = [];

  for (const [id, rows] of byMaterial) {
    const first = rows[0];
    const fact = factByKey.get(id);

    // ── 1. 담당자별 소요량 ──────────────────────────────────
    const perOwner = new Map<string, { owner: ResolvedOwner; req: number; products: number }>();
    const warnings = new Set<string>();
    let totalReq = 0;
    let totalProducts = 0;
    let activeProducts = 0;

    for (const row of rows) {
      const owner = resolveOwner(row);
      if (owner.ownerId === UNASSIGNED_OWNER_ID) {
        const key = `${row.rootBrand}|${row.rootCategory}|${row.rootFamily}`;
        const existing = unassigned.get(key);
        if (existing) existing.productCount = Math.max(existing.productCount, row.productCount);
        else {
          unassigned.set(key, {
            family: row.rootFamily,
            category: row.rootCategory,
            brand: row.rootBrand,
            productCount: row.productCount,
          });
        }
      }

      collectWarnings(row, thresholds.suspectQtyPerFg).forEach((warning) => warnings.add(warning));
      totalReq += row.requirement;
      totalProducts += row.productCount;
      activeProducts += row.activeProductCount;

      const entry = perOwner.get(owner.ownerId);
      if (entry) {
        entry.req += row.requirement;
        entry.products += row.productCount;
      } else {
        perOwner.set(owner.ownerId, { owner, req: row.requirement, products: row.productCount });
      }
    }

    // ── 2. 지분 산출 ────────────────────────────────────────
    // 최근 소요가 전혀 없으면(사장 자재) 비중을 못 낸다. 그렇다고 주인 없이 두면
    // 정확히 이 앱이 없애려는 상태가 되므로, 쓰는 완제품 수로 나눈다.
    const owners: OwnerShare[] = [...perOwner.values()]
      .map(({ owner, req, products }) => {
        const share = totalReq > 0 ? req / totalReq : products / Math.max(1, totalProducts);
        return {
          ownerId: owner.ownerId,
          ownerName: owner.ownerName,
          ownerTeam: owner.ownerTeam,
          share,
          allocatedValue: (fact?.stockValue ?? 0) * share,
          allocatedQty: (fact?.onHand ?? 0) * share,
        };
      })
      // 최근에 이 자재를 전혀 안 쓴 담당자는 뺀다. 남겨두면 ₩0 짜리 행이 그 사람
      // 화면에 쌓여 노이즈가 된다. BOM 상 쓰는 제품이 있다는 사실은 productCount 와
      // 역전개 드릴다운에 그대로 남는다. 지분합·배분금액은 영향받지 않는다(0을 뺀 것).
      .filter((share) => share.share > 0)
      .sort((a, b) => b.share - a.share);

    // ── 3. 위험 판정 (기준은 describeRiskCriteria 가 화면에 그대로 노출한다) ──
    const monthlyUse = totalReq / thresholds.usageLookbackMonths;
    const onHand = fact?.onHand ?? 0;
    const openPoQty = fact?.openPoQty ?? 0;
    const stockMonths = monthlyUse > 0 ? onHand / monthlyUse : null;
    const stockMonthsWithPo = monthlyUse > 0 ? (onHand + openPoQty) / monthlyUse : null;
    const hasStake = onHand > 0 || openPoQty > 0;

    const risks: MaterialRiskKind[] = [];
    // 전 공장 기준으로 살아 있는 완제품이 하나도 없다 → 완전 단종.
    // 마케팅이 제품을 접을 때 남는 자재가 정확히 이 케이스다.
    if (hasStake && activeProducts === 0) risks.push('DISCONTINUED_ONLY');
    // 사장은 "제품은 살아 있는데 이 공장에서 안 쓴다". 단종과 겹치지 않게 배타로 둔다.
    else if (hasStake && monthlyUse <= 0) risks.push('DEAD');
    if (stockMonths !== null && stockMonths > thresholds.excessMonths) risks.push('EXCESS');
    if (openPoQty > 0 && stockMonthsWithPo !== null && stockMonthsWithPo > thresholds.excessMonths) {
      risks.push('OVER_ORDERED');
    }

    insights.push({
      materialCode: first.materialCode,
      materialName: fact?.materialName || first.materialName,
      materialClass: first.materialClass,
      werks: first.werks,
      unit: fact?.unit || first.baseUom || first.bomUom || 'EA',
      onHand,
      unitPrice: fact?.unitPrice ?? 0,
      stockValue: fact?.stockValue ?? 0,
      openPoQty,
      openPoValue: fact?.openPoValue ?? 0,
      overduePoCount: fact?.overduePoCount ?? 0,
      productCount: totalProducts,
      // 전용/공용은 현업 용어 그대로 "이 자재를 한 담당 영역만 쓰는가"이며 BOM 사실로
      // 판정한다. 최근 실적으로 판정하면 이번 분기에 안 만든 브랜드가 빠지면서
      // 공용 자재가 전용으로 보이는 왜곡이 생긴다. 지분(owners)은 별개로 실적 기준이라
      // 공용인데 지분자가 한 명일 수 있다.
      kind: perOwner.size <= 1 ? 'DEDICATED' : 'SHARED',
      owners,
      monthlyUse,
      stockMonths,
      stockMonthsWithPo,
      risks,
      dataWarnings: [...warnings],
    });
  }

  return { insights, unassignedScopes: [...unassigned.values()] };
}

/** 담당자 한 명의 자재만 남긴다. 지분이 있으면 그 사람 화면에 뜬다. */
export function filterByOwner(insights: MaterialInsight[], ownerId: string): MaterialInsight[] {
  return insights.filter((insight) => insight.owners.some((owner) => owner.ownerId === ownerId));
}

export interface OwnerSummary {
  materialCount: number;
  /** 전용 자재 귀속 금액 */
  dedicatedValue: number;
  /** 공용 자재에서 배분된 금액 */
  sharedValue: number;
  totalValue: number;
  openPoValue: number;
  riskValue: Record<MaterialRiskKind, number>;
  riskCount: Record<MaterialRiskKind, number>;
}

const RISK_KINDS: MaterialRiskKind[] = ['DEAD', 'DISCONTINUED_ONLY', 'EXCESS', 'OVER_ORDERED'];

/**
 * 담당자 관점 요약.
 * 전용과 공용배분을 반드시 나눠서 낸다. 합쳐서 한 숫자로만 보여주면
 * 공용 배분분에 대해 "내 탓 아니다"가 나오고 화면 전체의 신뢰가 무너진다.
 */
export function summarizeForOwner(insights: MaterialInsight[], ownerId: string): OwnerSummary {
  const summary: OwnerSummary = {
    materialCount: 0,
    dedicatedValue: 0,
    sharedValue: 0,
    totalValue: 0,
    openPoValue: 0,
    riskValue: { DEAD: 0, DISCONTINUED_ONLY: 0, EXCESS: 0, OVER_ORDERED: 0 },
    riskCount: { DEAD: 0, DISCONTINUED_ONLY: 0, EXCESS: 0, OVER_ORDERED: 0 },
  };

  for (const insight of insights) {
    const share = insight.owners.find((owner) => owner.ownerId === ownerId);
    if (!share) continue;

    summary.materialCount += 1;
    if (insight.kind === 'DEDICATED') summary.dedicatedValue += share.allocatedValue;
    else summary.sharedValue += share.allocatedValue;
    summary.totalValue += share.allocatedValue;
    summary.openPoValue += insight.openPoValue * share.share;

    for (const kind of RISK_KINDS) {
      if (!insight.risks.includes(kind)) continue;
      summary.riskCount[kind] += 1;
      summary.riskValue[kind] +=
        kind === 'OVER_ORDERED' ? insight.openPoValue * share.share : share.allocatedValue;
    }
  }

  return summary;
}

/**
 * 이 자재 재고로 이 완제품을 몇 개 만들 수 있나.
 *
 * ⚠️ "이 자재를 이 완제품에만 전량 투입할 때"의 값이다. 공용 자재는 여러 제품이
 *    나눠 쓰므로 화면에 그 문장을 반드시 함께 띄운다. 이 오해가 오판의 1순위다.
 */
export function buildableQuantity(onHand: number, qtyPerFg: number): number | null {
  if (!(qtyPerFg > 0) || !(onHand > 0)) return null;
  return Math.floor(onHand / qtyPerFg);
}
