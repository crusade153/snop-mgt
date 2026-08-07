/** 자재 연결성 도메인 타입 */

/** BOM 리프 1행 = 완제품 × 자재 × 공장. 수량은 완제품 1 기본단위당. */
export interface BomLeafRow {
  rootMatnr: string;
  rootName: string;
  rootBrand: string;
  rootCategory: string;
  rootFamily: string;
  rootUom: string;
  werks: string;
  materialCode: string;
  materialName: string;
  materialClass: string;
  bomUom: string;
  baseUom: string;
  uomMismatch: boolean;
  qtyPerFg: number;
  hasFixedQty: boolean;
  hasBadQty: boolean;
  suspectLotBasis: boolean;
  stlalCount: number;
  minLevel: number;
  maxLevel: number;
  pathCount: number;
  hitDepthCap: boolean;
  /** 경유 반제품 체인. '(직접)' 이면 완제품에 바로 투입된다. */
  viaPaths: string[];
}

export interface BomBuildRun {
  buildId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  scope: string;
  triggeredByName: string | null;
  rowCount: number | null;
  rootCount: number | null;
  materialCount: number | null;
  bqMs: number | null;
  depthCapHits: number | null;
  uomMismatchCount: number | null;
  suspectLotBasisCount: number | null;
  errorMessage: string | null;
}

/** 자재 마스터 + 재고 + 발주. BigQuery 에서 온다. */
export interface MaterialFact {
  materialCode: string;
  materialName: string;
  werks: string;
  /** MM_MARD 가용재고 합계 */
  onHand: number;
  unit: string;
  /** MM_ZMMR1140 이동평균가 */
  unitPrice: number;
  stockValue: number;
  /** 미입고 발주 잔량 (MM_ZMMR0020, EBELN+EBELP 집계 후) */
  openPoQty: number;
  openPoValue: number;
  openPoCount: number;
  /** 납기가 지난 미입고 발주 건수 */
  overduePoCount: number;
  leadTimeDays: number | null;
}

/**
 * 자재 소요량 집계 1행 = (자재 × 공장 × 제품계층).
 * BigQuery 에서 BOM 전개 × 생산실적을 접은 결과다. 원·부자재까지 넓히면 리프가
 * 5만행이 넘어 그대로는 못 다루기 때문에 이 단위로 받는다.
 */
export interface MaterialRequirementRow {
  materialCode: string;
  werks: string;
  materialName: string;
  materialClass: string;
  bomUom: string;
  baseUom: string;
  rootBrand: string;
  rootCategory: string;
  rootFamily: string;
  /** Σ (완제품 생산실적 × 완제품 1개당 소요량). 계산 불가 행은 빠져 있다. */
  requirement: number;
  /** 이 계층에서 이 자재를 쓰는 완제품 수 */
  productCount: number;
  /** 그중 최근 기간에 전 공장 기준 한 번이라도 생산된 완제품 수. 0이면 전부 단종. */
  activeProductCount: number;
  maxQtyPerFg: number;
  hasFixedQty: boolean;
  hasBadQty: boolean;
  suspectLotBasis: boolean;
  uomMismatch: boolean;
}

/** 완제품별 최근 생산실적. 드릴다운에서 "최근 생산" 표시에 쓴다. 단위는 EA 정규화 값. */
export interface ProductUsage {
  matnr: string;
  werks: string;
  /** 조회 기간 전체 실적 (EA) */
  actualQty: number;
  /** 원본 단위. BOX/KG 였다면 정규화 전 값을 추적하기 위해 남긴다. */
  sourceUnit: string;
}

export type OwnerScopeType = 'BRAND' | 'CATEGORY' | 'FAMILY';

export interface ProductOwner {
  id: string;
  scopeType: OwnerScopeType;
  scopeKey: string;
  ownerId: string;
  ownerName: string;
  ownerTeam: string | null;
  role: 'PRIMARY' | 'BACKUP';
}

/** 담당 미지정을 나타내는 고정 키. 조용히 버리면 "주인 없음"이 그대로 재현된다. */
export const UNASSIGNED_OWNER_ID = '__unassigned__';
export const UNASSIGNED_OWNER_NAME = '(담당 미지정)';

/** 자재 하나가 여러 담당자에게 걸릴 때의 지분 */
export interface OwnerShare {
  ownerId: string;
  ownerName: string;
  ownerTeam: string | null;
  /** 0~1. 최근 실적 기준 소요비중. */
  share: number;
  /** 이 담당자 몫으로 배분된 재고금액 */
  allocatedValue: number;
  allocatedQty: number;
}

export type MaterialRiskKind =
  /** 최근 소요가 0인데 재고가 남아 있다 — 단종·리뉴얼된 제품의 포장재 */
  | 'DEAD'
  /** 이 자재를 쓰는 완제품이 전부 생산 중단 — 100% 폐기 후보 */
  | 'DISCONTINUED_ONLY'
  /** 재고월수가 임계 초과 */
  | 'EXCESS'
  /** 재고 + 미입고 발주가 소요 대비 과다 */
  | 'OVER_ORDERED';

/** 자재 1건의 최종 분석 결과. 화면 한 행. */
export interface MaterialInsight {
  materialCode: string;
  materialName: string;
  /** 자재대역 앞자리. 1=원재료 2=부재료 3=포장재. 화면 필터 기준. */
  materialClass: string;
  werks: string;
  unit: string;
  onHand: number;
  unitPrice: number;
  stockValue: number;
  openPoQty: number;
  openPoValue: number;
  overduePoCount: number;
  /** 이 자재를 쓰는 완제품 수 */
  productCount: number;
  /** 담당자가 1명이면 전용, 2명 이상이면 공용 */
  kind: 'DEDICATED' | 'SHARED';
  owners: OwnerShare[];
  /** 최근 기간 월평균 소요량 */
  monthlyUse: number;
  /** onHand / monthlyUse. monthlyUse 가 0 이면 null (사장 자재) */
  stockMonths: number | null;
  /** (onHand + openPoQty) / monthlyUse */
  stockMonthsWithPo: number | null;
  risks: MaterialRiskKind[];
  /** 계산에서 제외된 이유. 있으면 화면에 경고 뱃지가 뜬다. */
  dataWarnings: string[];
}
