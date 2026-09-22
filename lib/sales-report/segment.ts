// lib/sales-report/segment.ts
// 매출 리포트의 **팀·채널·제품구분 판정** — I/O 없는 순수 함수만 둔다.
//
// 이 파일은 새 기준을 만들지 않는다. 판정은 전부 `/weekly` 가 쓰는 것을 그대로 가져다 쓴다
// (`lib/weekly/classification.ts`, `lib/weekly/channel.ts`).
// 재고를 팀·채널로 찢어 보던 사람이 매출을 같은 축으로 볼 수 있어야 하기 때문이고,
// 여기에 「매출용 팀 기준」을 따로 만들면 두 화면의 CM1 이 다른 것을 가리키게 된다.
//
// ⚠️ **CM 은 카테고리 기본값(`cmOfCategory`)만 쓴다.** `/weekly` 는 `snop_cm_mapping` 을 먼저 보고
// 없을 때 이 기본값으로 떨어지는데, 그 표는 지금 **비어 있다**(실측 0행 — SAP 에 CM 기준정보가
// 아직 없어서 제품계층 4레벨로 올라올 때까지 비워 둔 것이다). 그래서 오늘은 두 화면의 값이 같다.
// 표에 행이 생기면 이 화면도 같이 읽어야 갈리지 않는다 — 그때 이 주석을 지우고 매핑을 넘길 것.

import { channelOfLv2, type WeeklyChannel } from '@/lib/weekly/channel';
import {
  categoryOfMaterial,
  cmOfCategory,
  pickFallbackDispo,
  pickPrimaryDispo,
  rowSortWeight,
  type WeeklyCategory,
  type WeeklyCm,
} from '@/lib/weekly/classification';
import type { SalesProductScope } from './query';

/** 자재 하나의 분류 결과. 제품 표의 열과 구성비 축이 전부 이 값을 쓴다. */
export interface SalesSegment {
  cm: WeeklyCm;
  category: WeeklyCategory;
  /** 표시용 팀 이름 — `/weekly` 「팀별」 표의 행 이름과 같은 조합(CM × 카테고리)이다 */
  team: string;
  channel: WeeklyChannel;
  /** 판정 근거로 쓴 대표 DISPO. 마스터에 없으면 빈 문자열 */
  dispo: string;
  /** 판정 근거로 쓴 제품계층 LV2. 마스터에 없으면 빈 문자열 */
  lv2: string;
}

/** 자재 마스터에서 끌어온 판정 재료. 액션이 BigQuery 로 채워 `buildSalesBoard` 에 넘긴다. */
export interface SalesMasterMaps {
  /** MATNR → 대표 DISPO */
  dispo: Map<string, string>;
  /** MATNR → 제품계층 LV2 텍스트(`SD_MARA.PRDHA_2_T`) */
  lv2: Map<string, string>;
}

export const EMPTY_SALES_MASTER: SalesMasterMaps = { dispo: new Map(), lv2: new Map() };

/**
 * 팀 이름. `상품`·`미분류` 는 CM 이 곧 이름이라 카테고리를 덧붙이지 않는다
 * (「상품 상품」·「미분류 기타」 같은 겹말을 만들지 않기 위한 것).
 */
export function teamLabelOf(cm: WeeklyCm, category: WeeklyCategory): string {
  if (cm === '상품' || cm === '미분류') return cm;
  return `${cm} ${category}`;
}

/** 팀 축의 행 순서. `/weekly` 「팀별」 표와 같은 정렬 가중치를 쓴다 */
export function teamSortWeight(cm: WeeklyCm, category: WeeklyCategory): number {
  return rowSortWeight(cm, category);
}

/**
 * 자재 하나의 팀·채널 판정.
 *
 * 카테고리 판정 순서(자재코드 6 대역 → DISPO → 사업부 임시 매핑)는 `categoryOfMaterial` 그대로다.
 * 채널은 제품계층 LV2 한 값으로만 정한다(`channelOfLv2`) — 표에 없는 LV2 는 `미분류` 로 남겨
 * 「진짜 기타」와 「매핑 누락」이 섞이지 않게 한다.
 *
 * ⚠️ 완제품·상품 대역(5·6) 밖의 자재는 DISPO·LV2 마스터 조회 대역 자체에 없어 둘 다 빈 값이다.
 * 그래서 팀은 `미분류`, 채널은 `미분류` 가 된다 — 지어내지 않고 그대로 드러낸다.
 * 이 자재들은 제품 구분 「기타」 버튼으로 따로 떼어 볼 수 있다.
 */
export function resolveSalesSegment(
  materialCode: string,
  dispo: string,
  lv2: string
): SalesSegment {
  const category = categoryOfMaterial(materialCode, dispo);
  const cm = cmOfCategory(category);
  return {
    cm,
    category,
    team: teamLabelOf(cm, category),
    channel: channelOfLv2(lv2),
    dispo,
    lv2,
  };
}

/**
 * 자재코드 → 제품 구분. 필터(`SalesProductScope`)가 SQL 에서 거는 대역과 **같은 경계**다.
 * 엑셀 파일에 구분 열을 싣기 위해 한 번 더 판정하는 것이므로 경계를 따로 손대지 말 것.
 */
export function productScopeOfMaterial(materialCode: string): Exclude<SalesProductScope, 'ALL'> {
  const code = String(materialCode || '').trim();
  if (/^5\d{7}$/.test(code)) return 'FERT';
  if (/^6\d{7}$/.test(code)) return 'HAWA';
  return 'ETC';
}

// ─────────────────────────────────────────────────────────────
// 마스터 원시행 → 판정 재료
// ─────────────────────────────────────────────────────────────

/** `buildSalesDispoMasterQuery`(./query.ts)가 돌려주는 행 */
export interface SalesDispoRow {
  MATNR: string;
  /** 저장위치 마스터(MM_MARD)의 생산 플랜트 후보. 플랜트 코드 오름차순 */
  MARD_CANDIDATES?: (string | null)[] | null;
  /** 플랜트 마스터(SD_MARC)의 생산 플랜트 후보. MM_MARD 에 없을 때만 본다 */
  MARC_CANDIDATES?: (string | null)[] | null;
  /** 판매법인(1031) 후보. 생산 후보가 하나도 없을 때 상품(H01)만 폴백으로 받는다 */
  SALES_CANDIDATES?: (string | null)[] | null;
}

/** `buildMaterialHierarchyQuery`(lib/weekly/queries.ts)가 돌려주는 행 */
export interface SalesHierarchyRow {
  MATNR: string;
  PRDHA_2_T?: string | null;
}

/**
 * 마스터 원시행 → 판정 재료.
 *
 * 대표 DISPO 는 **세 단계**로 고른다. 앞 단계가 값을 내면 뒤는 보지 않는다.
 *
 *  1) 저장위치 마스터(MM_MARD)의 생산 플랜트 후보 — `/weekly` 적재
 *     (`lib/weekly/snapshot-builder.ts`)가 쓰는 것과 **같은 원천·같은 선택 규칙**이다.
 *     그래야 재고 화면이 이미 분류하고 있는 SKU 의 팀이 이 화면에서 달라지지 않는다.
 *  2) 플랜트 마스터(SD_MARC)의 생산 플랜트 후보 — **재고 없이 팔린 SKU** 를 받는 자리다.
 *     저장위치 행이 없으면 1 이 비는데, 매출에는 그런 SKU 가 완제품 매출의 23.6%나 된다
 *     (`buildSalesDispoMasterQuery` 주석의 실측 참고).
 *  3) 판매법인(1031) 후보에서 상품(H01)만 — 생산 마스터가 아예 없는 상품을 받는다.
 *
 * ⚠️ 선택 규칙(`pickPrimaryDispo`·`pickFallbackDispo`)은 `/weekly` 와 같은 순수 함수를 그대로 쓴다.
 * 여기서 규칙을 새로 쓰면 같은 자재가 재고 화면과 매출 화면에서 다른 팀에 잡힌다.
 */
export function buildSalesMasterMaps(
  dispoRows: SalesDispoRow[],
  hierarchyRows: SalesHierarchyRow[]
): SalesMasterMaps {
  const dispo = new Map<string, string>();
  for (const row of dispoRows) {
    const code = String(row.MATNR || '').trim();
    if (!code) continue;
    const value =
      pickPrimaryDispo(row.MARD_CANDIDATES || []) ||
      pickPrimaryDispo(row.MARC_CANDIDATES || []) ||
      pickFallbackDispo(row.SALES_CANDIDATES || []);
    if (value) dispo.set(code, value);
  }

  const lv2 = new Map<string, string>();
  for (const row of hierarchyRows) {
    const code = String(row.MATNR || '').trim();
    const value = String(row.PRDHA_2_T || '').trim();
    if (code && value) lv2.set(code, value);
  }

  return { dispo, lv2 };
}
