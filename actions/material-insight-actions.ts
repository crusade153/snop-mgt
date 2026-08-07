'use server';

/**
 * 자재 연결성 화면의 조립 지점 — BOM 마트(Supabase) + 자재 사실(BigQuery) + 담당자 매핑
 *
 * ⚠️ 조립된 결과는 unstable_cache 에 넣지 않는다. 자재 × 공장 조합이 2천 건 가까이 되고
 *    담당자 지분 배열까지 붙으면 1MB 안팎이라 2MB 항목 제한에 위험하게 가깝다
 *    (넘으면 조용히 저장에 실패하고 매 요청 재계산하면서 낡은 값을 준다).
 *    비싼 쪽(BigQuery 호출)은 이미 각 액션에서 캐시되고, Supabase 마트 조회는
 *    인덱스가 있어 빠르므로 조립만 매번 다시 한다.
 */

import { getAdminContext } from '@/lib/admin-auth';
import {
  getBomLeafByMaterials,
  getForwardBom,
  getLatestBomBuild,
  getReverseBom,
} from '@/lib/bom/mart';
import {
  getDirectBomUsage,
  getMaterialFacts,
  getMaterialRequirements,
  getProductUsage,
} from '@/actions/material-actions';
import {
  allocateMaterials,
  buildableQuantity,
  createOwnerResolver,
  describeRiskCriteria,
  summarizeForOwner,
  DEFAULT_THRESHOLDS,
  type AllocationThresholds,
  type OwnerSummary,
} from '@/lib/material/allocation';
import { loadProductOwners, loadThresholds } from '@/lib/material/ownership';
import {
  UNASSIGNED_OWNER_ID,
  type BomBuildRun,
  type DirectBomParent,
  type MaterialInsight,
} from '@/types/material';

export interface MaterialInsightPayload {
  success: boolean;
  message?: string;
  build: BomBuildRun | null;
  /** 로그인 사용자가 담당자로 등록돼 있으면 그 id */
  viewerOwnerId: string | null;
  viewerName: string;
  isAdmin: boolean;
  /** 화면에 뜨는 자재 목록. scope 에 따라 이미 걸러진 상태다. */
  insights: MaterialInsight[];
  summary: OwnerSummary | null;
  /** 담당자 선택 목록 (관리자·전체 보기용) */
  ownerOptions: { ownerId: string; ownerName: string; materialCount: number }[];
  /** 담당자가 지정되지 않은 제품계층 수. 0 이 되어야 자재에 주인이 다 생긴다. */
  unassignedScopeCount: number;
  thresholds: AllocationThresholds;
  /** 위험 판정 기준을 실제 임계값·기간으로 풀어 쓴 설명. 화면에 그대로 노출한다. */
  criteria: ReturnType<typeof describeRiskCriteria>;
}

export async function getMaterialInsights(options: {
  ownerId?: string;
  scope?: 'MINE' | 'ALL';
} = {}): Promise<MaterialInsightPayload> {
  const context = await getAdminContext();
  if (!context.user || !context.isActive) {
    return {
      success: false,
      message: '로그인이 필요합니다.',
      build: null,
      viewerOwnerId: null,
      viewerName: '',
      isAdmin: false,
      insights: [],
      summary: null,
      ownerOptions: [],
      unassignedScopeCount: 0,
      thresholds: DEFAULT_THRESHOLDS,
      criteria: describeRiskCriteria(DEFAULT_THRESHOLDS),
    };
  }

  const viewerId = context.user.id;
  const viewerName = String(context.profile?.full_name ?? context.user.email ?? '');

  const [build, owners, thresholds] = await Promise.all([
    getLatestBomBuild(),
    loadProductOwners(),
    loadThresholds(),
  ]);

  if (!build || build.status !== 'SUCCESS') {
    return {
      success: false,
      message:
        build?.status === 'FAILED'
          ? `BOM 마트 빌드가 실패한 상태입니다: ${build.errorMessage ?? '원인 미상'}`
          : 'BOM 마트가 아직 적재되지 않았습니다. 관리자 → BOM 마트에서 재빌드를 실행해주세요.',
      build,
      viewerOwnerId: null,
      viewerName,
      isAdmin: context.isAdmin,
      insights: [],
      summary: null,
      ownerOptions: [],
      unassignedScopeCount: 0,
      thresholds,
      criteria: describeRiskCriteria(thresholds),
    };
  }

  const [requirements, facts] = await Promise.all([
    getMaterialRequirements(),
    getMaterialFacts(),
  ]);

  const { insights, unassignedScopes } = allocateMaterials({
    requirements,
    facts,
    owners,
    thresholds,
  });

  // 담당자별 자재 건수 — 선택 드롭다운과 "미지정" 노출용
  const counts = new Map<string, { ownerName: string; materialCount: number }>();
  for (const insight of insights) {
    for (const owner of insight.owners) {
      const entry = counts.get(owner.ownerId);
      if (entry) entry.materialCount += 1;
      else counts.set(owner.ownerId, { ownerName: owner.ownerName, materialCount: 1 });
    }
  }
  const ownerOptions = [...counts.entries()]
    .map(([ownerId, value]) => ({ ownerId, ...value }))
    .sort((a, b) => {
      // 미지정은 항상 끝에 둔다 — 숨기지는 않는다.
      if (a.ownerId === UNASSIGNED_OWNER_ID) return 1;
      if (b.ownerId === UNASSIGNED_OWNER_ID) return -1;
      return b.materialCount - a.materialCount;
    });

  const viewerIsOwner = counts.has(viewerId);
  const scope = options.scope ?? (viewerIsOwner ? 'MINE' : 'ALL');
  const targetOwnerId = options.ownerId ?? (scope === 'MINE' ? viewerId : null);

  const visible = targetOwnerId
    ? insights.filter((insight) => insight.owners.some((owner) => owner.ownerId === targetOwnerId))
    : insights;

  return {
    success: true,
    build,
    viewerOwnerId: viewerIsOwner ? viewerId : null,
    viewerName,
    isAdmin: context.isAdmin,
    insights: visible,
    summary: targetOwnerId ? summarizeForOwner(insights, targetOwnerId) : null,
    ownerOptions,
    unassignedScopeCount: unassignedScopes.length,
    thresholds,
    criteria: describeRiskCriteria(thresholds),
  };
}

export interface ReverseBomEntry {
  rootMatnr: string;
  rootName: string;
  rootFamily: string;
  rootBrand: string;
  ownerName: string;
  qtyPerFg: number;
  /** 경유 반제품 체인. '(직접)' 이면 완제품에 바로 투입된다. */
  viaPaths: string[];
  minLevel: number;
  /** 이 자재 재고를 이 완제품에만 전량 투입할 때 만들 수 있는 수량 */
  buildable: number | null;
  /** 최근 기간 생산실적 (EA) */
  recentProduced: number;
  warning: string | null;
}

export interface MaterialDetailPayload {
  success: boolean;
  message?: string;
  materialCode: string;
  materialName: string;
  werks: string;
  unit: string;
  onHand: number;
  entries: ReverseBomEntry[];
  directParents: DirectBomParent[];
}

/**
 * 자재 하나의 역전개 — 이 자재를 쓰는 완제품 목록과 생산가능수량.
 * 마케팅이 실제로 묻는 질문이고, (material_code, werks) 인덱스로 즉답된다.
 */
export async function getMaterialDetail(
  materialCode: string,
  werks: string,
): Promise<MaterialDetailPayload> {
  const context = await getAdminContext();
  const empty = {
    materialCode,
    materialName: '',
    werks,
    unit: '',
    onHand: 0,
    entries: [] as ReverseBomEntry[],
    directParents: [] as DirectBomParent[],
  };
  if (!context.user || !context.isActive) {
    return { success: false, message: '로그인이 필요합니다.', ...empty };
  }

  const [rows, facts, owners, thresholds, directParents] = await Promise.all([
    getReverseBom(materialCode, werks),
    getMaterialFacts(),
    loadProductOwners(),
    loadThresholds(),
    getDirectBomUsage(materialCode, werks),
  ]);

  const usage = await getProductUsage(thresholds.usageLookbackMonths);
  const usageByPlant = new Map<string, number>();
  for (const row of usage) {
    const key = `${row.werks}|${row.matnr}`;
    usageByPlant.set(key, (usageByPlant.get(key) ?? 0) + row.actualQty);
  }

  const fact = facts.find((item) => item.materialCode === materialCode && item.werks === werks);
  const resolveOwner = createOwnerResolver(owners);
  const onHand = fact?.onHand ?? 0;

  const entries: ReverseBomEntry[] = rows
    .map((row) => {
      const blocked = row.hasFixedQty || row.hasBadQty || row.suspectLotBasis || row.uomMismatch;
      let warning: string | null = null;
      if (row.hasFixedQty) warning = '로트 고정수량 — 완제품 1개당 환산 불가';
      else if (row.hasBadQty) warning = 'BOM 수량 파싱 불가';
      else if (row.suspectLotBasis) warning = '기준수량 오등록 의심';
      else if (row.uomMismatch) warning = `단위 불일치 (${row.bomUom} ≠ ${row.baseUom})`;
      else if (row.qtyPerFg > thresholds.suspectQtyPerFg) warning = 'BOM 검토 필요 (소요량 과다)';

      return {
        rootMatnr: row.rootMatnr,
        rootName: row.rootName,
        rootFamily: row.rootFamily,
        rootBrand: row.rootBrand,
        ownerName: resolveOwner(row).ownerName,
        qtyPerFg: row.qtyPerFg,
        viaPaths: row.viaPaths,
        minLevel: row.minLevel,
        buildable: blocked ? null : buildableQuantity(onHand, row.qtyPerFg),
        recentProduced: usageByPlant.get(`${row.werks}|${row.rootMatnr}`) ?? 0,
        warning,
      };
    })
    .sort((a, b) => b.recentProduced - a.recentProduced || b.qtyPerFg - a.qtyPerFg);

  return {
    success: true,
    materialCode,
    materialName: fact?.materialName || rows[0]?.materialName || '',
    werks,
    unit: fact?.unit || rows[0]?.baseUom || 'EA',
    onHand,
    entries,
    directParents,
  };
}

export interface ForwardBomEntry {
  materialCode: string;
  materialName: string;
  /** 1=원재료 2=부재료 3=포장재 */
  materialClass: string;
  werks: string;
  qtyPerFg: number;
  bomUom: string;
  viaPaths: string[];
  minLevel: number;
  onHand: number;
  unit: string;
  stockValue: number;
  openPoQty: number;
  /** 이 자재 재고만으로 이 완제품을 몇 개 만들 수 있나 */
  buildable: number | null;
  /** 이 자재를 쓰는 다른 완제품 수 (0이면 이 제품 전용) */
  sharedWithCount: number;
  warning: string | null;
}

/**
 * 정전개 — 이 완제품이 쓰는 자재.
 * 제품 상세에서 자재로, /materials 에서 자재→완제품으로. 양방향이 이어져야
 * "완제품에서 자재까지 한 번에" 가 성립한다.
 */
export async function getProductMaterials(matnr: string): Promise<{
  success: boolean;
  message?: string;
  entries: ForwardBomEntry[];
}> {
  const context = await getAdminContext();
  if (!context.user || !context.isActive) {
    return { success: false, message: '로그인이 필요합니다.', entries: [] };
  }

  const [rows, facts, thresholds] = await Promise.all([
    getForwardBom(matnr),
    getMaterialFacts(),
    loadThresholds(),
  ]);
  if (!rows.length) return { success: true, entries: [] };

  // 공용 여부를 알려면 각 자재의 전체 사용처를 봐야 한다.
  const allUsers = await getBomLeafByMaterials(rows.map((row) => row.materialCode));
  const userCount = new Map<string, Set<string>>();
  for (const row of allUsers) {
    const set = userCount.get(row.materialCode) ?? new Set<string>();
    set.add(row.rootMatnr);
    userCount.set(row.materialCode, set);
  }

  const factByKey = new Map(facts.map((fact) => [`${fact.werks}|${fact.materialCode}`, fact]));

  const entries: ForwardBomEntry[] = rows
    .map((row) => {
      const fact = factByKey.get(`${row.werks}|${row.materialCode}`);
      const blocked = row.hasFixedQty || row.hasBadQty || row.suspectLotBasis || row.uomMismatch;
      let warning: string | null = null;
      if (row.hasFixedQty) warning = '로트 고정수량 — 완제품 1개당 환산 불가';
      else if (row.hasBadQty) warning = 'BOM 수량 파싱 불가';
      else if (row.suspectLotBasis) warning = '기준수량 오등록 의심';
      else if (row.uomMismatch) warning = `단위 불일치 (${row.bomUom} ≠ ${row.baseUom})`;
      else if (row.qtyPerFg > thresholds.suspectQtyPerFg) warning = 'BOM 검토 필요 (소요량 과다)';

      const onHand = fact?.onHand ?? 0;
      return {
        materialCode: row.materialCode,
        materialName: fact?.materialName || row.materialName,
        materialClass: row.materialClass,
        werks: row.werks,
        qtyPerFg: row.qtyPerFg,
        bomUom: row.bomUom,
        viaPaths: row.viaPaths,
        minLevel: row.minLevel,
        onHand,
        unit: fact?.unit || row.baseUom || 'EA',
        stockValue: fact?.stockValue ?? 0,
        openPoQty: fact?.openPoQty ?? 0,
        buildable: blocked ? null : buildableQuantity(onHand, row.qtyPerFg),
        sharedWithCount: Math.max(0, (userCount.get(row.materialCode)?.size ?? 1) - 1),
        warning,
      };
    })
    .sort((a, b) => {
      // 병목부터 보여준다 — 이 제품을 못 만들게 할 자재가 맨 위.
      if (a.buildable === null) return 1;
      if (b.buildable === null) return -1;
      return a.buildable - b.buildable;
    });

  return { success: true, entries };
}
