/**
 * 주간 장표 집계·문구 생성 — I/O 없는 순수 함수
 *
 * 적재는 SKU × 창고그룹 단위로 하고, 화면에 뿌릴 CM × 공장 × 카테고리 표는 여기서 접는다.
 * **집계해서 저장하지 않는 이유**: CM 매핑이 아직 확정 전이고 제품계층 4레벨로 교체될 예정이라,
 * 접어서 저장하면 매핑이 바뀌었을 때 과거 주차를 다시 쪼갤 수 없다.
 */

import { isOverriddenMaterial } from '@/lib/weekly/category-overrides';
import {
  channelOfLv2,
  channelSortWeight,
  WEEKLY_CHANNEL_ORDER,
  type WeeklyChannel,
} from '@/lib/weekly/channel';
import {
  categoryOfDispo,
  categoryOfMaterial,
  cmOfCategory,
  plantOfCategory,
  rowSortWeight,
  WEEKLY_CATEGORY_ORDER,
  type WeeklyCategory,
  type WeeklyCm,
  type WeeklyPlant,
  type WeeklyStorageScope,
} from '@/lib/weekly/classification';

/** 잔여율 구간. 원본 엑셀의 5구간을 그대로 쓴다. */
export interface WeeklyBuckets {
  under50: number;
  r50_70: number;
  r70_75: number;
  r75_85: number;
  over85: number;
}

export const WEEKLY_BUCKET_KEYS: (keyof WeeklyBuckets)[] = [
  'under50',
  'r50_70',
  'r70_75',
  'r75_85',
  'over85',
];

export const WEEKLY_BUCKET_LABELS: Record<keyof WeeklyBuckets, string> = {
  under50: '50% 미만 [내부소진]',
  r50_70: '50~70% [온라인]',
  r70_75: '70~75% [주의]',
  r75_85: '75~85% [안전]',
  over85: '85% 이상 [안전]',
};

export const createWeeklyBuckets = (): WeeklyBuckets => ({
  under50: 0,
  r50_70: 0,
  r70_75: 0,
  r75_85: 0,
  over85: 0,
});

/**
 * 잔여율 → 구간 키.
 *
 * ⚠️ 기한없음 재고는 여기 들어오면 안 된다. 플랜트의 기한없음 배치는 remain_rate 가 0 으로 내려와
 * 전부 '~50%' 로 오분류된 전례가 있다. 호출부에서 걸러 `over85` 로 보낸다.
 */
export function weeklyBucketKeyOf(remainRate: number): keyof WeeklyBuckets {
  if (remainRate < 50) return 'under50';
  if (remainRate < 70) return 'r50_70';
  if (remainRate < 75) return 'r70_75';
  if (remainRate < 85) return 'r75_85';
  return 'over85';
}

/** 적재 테이블 한 행 = 주차 × SKU × 창고그룹 */
export interface WeeklySnapshotRow {
  week_end_date: string;
  material_code: string;
  storage_scope: WeeklyStorageScope;
  product_name: string;
  dispo: string | null;
  plant: WeeklyPlant;
  category: WeeklyCategory;
  unit: string;
  stock_qty: number;
  stock_value: number;
  bucket_under50: number;
  bucket_50_70: number;
  bucket_70_75: number;
  bucket_75_85: number;
  bucket_85_over: number;
  /** 잔여율 구간별 재고수량. 열 추가 전 주차는 값이 없을 수 있다 */
  bucket_qty_under50?: number;
  bucket_qty_50_70?: number;
  bucket_qty_70_75?: number;
  bucket_qty_75_85?: number;
  bucket_qty_85_over?: number;
  shipped_qty: number;
  shipped_value: number;
  /** 당월 1일~주차 종료일 누적 출고. 금액은 주간 출고와 같은 재고단가 환산이다 */
  shipped_mtd_qty: number;
  shipped_mtd_value: number;
  produced_qty: number;
  produced_value: number;
  sales_amount: number;
  sales_mtd: number;
  unit_price: number;
  price_month: string | null;
  price_source: string;
  /**
   * 그 SKU·창고그룹에서 **가장 임박한 배치의 잔여일**. 유통기한이 없는 재고뿐이면 null.
   * 상세표의 「소비기한 임박」 정렬 축이다.
   *
   * ⚠️ 이 열은 나중에 추가됐다. 그 전에 적재된 주차는 null 이므로 화면에서 '-' 로 비워야 한다
   * (재고는 소급 생성이 불가능해 과거 주차를 다시 찍어 채울 수 없다).
   */
  min_remain_day?: number | null;
  /** 금액 가중 평균 잔여율(%). 기한없음 재고는 분모에서 뺀다 */
  avg_remain_rate?: number | null;
}

/**
 * 축과 무관한 집계 값 — 팀별 표와 채널별 표가 **같은 계산을 공유**한다.
 *
 * ⚠️ 두 축은 같은 재고를 다르게 접은 것뿐이라 합계가 원 단위까지 같아야 한다.
 * 그래서 집계·비율·대차 계산은 여기 한 벌만 두고 축별 빌더는 「무엇으로 묶을지」만 정한다.
 * 축마다 따로 더하기 시작하면 두 탭의 합계가 갈려 사용자가 어느 쪽을 믿어야 할지 알 수 없게 된다.
 */
export interface WeeklyBoardMetrics {
  previousStockValue: number;
  shippedValue: number;
  producedValue: number;
  stockValue: number;
  buckets: WeeklyBuckets;
  /** 당월 누적 출고금액 (재고와 같은 단가) */
  shipmentMtd: number;
  /** 당월 누적 실제 납품매출액(NETWR). 「월 매출 比 재고금액」의 분모 */
  salesMtd: number;
  /**
   * 재고금액 ÷ 당월 누적 출고금액. 분모가 0 이면 null.
   *
   * 분자·분모가 **둘 다 완제품 재고단가**라 배수를 그대로 "월 출고량의 몇 배를 쌓아두고 있는가"로 읽는다.
   * 예전 분모였던 매출액(NETWR)은 판매가라 마진율만큼 비율이 눌렸다.
  */
  stockToShipmentRatio: number | null;
  /** 재고금액 ÷ 당월 누적 실제 납품매출액(NETWR). 분모가 0 이면 null */
  stockToSalesRatio: number | null;
  /** 전주 재고 + 생산 − 출고 와 당주 재고의 차이. 폐기·반품·재평가가 섞여 0 이 되지 않는다 */
  balanceGap: number;
}

/** 팀별 축 표의 한 줄 (CM × 공장 × 카테고리) */
export interface WeeklyBoardRow extends WeeklyBoardMetrics {
  cm: WeeklyCm;
  plant: WeeklyPlant;
  category: WeeklyCategory;
}

/** 채널별 축 표의 한 줄 (채널 하나). 제품계층 LV2 로 판정한다 */
export interface WeeklyChannelRow extends WeeklyBoardMetrics {
  channel: WeeklyChannel;
}

export interface WeeklyBoardTotals extends WeeklyBoardMetrics {
  rowCount: number;
}

/** 구간별 주간 재고변동 표 (전주 구간액 → 당주 구간액) */
export interface WeeklyBucketMovement {
  previous: WeeklyBuckets;
  current: WeeklyBuckets;
  delta: WeeklyBuckets;
  rate: WeeklyBuckets;
  previousTotal: number;
  currentTotal: number;
  deltaTotal: number;
  rateTotal: number;
}

export function sumBuckets(buckets: WeeklyBuckets) {
  return WEEKLY_BUCKET_KEYS.reduce((sum, key) => sum + (buckets[key] || 0), 0);
}

function addBuckets(target: WeeklyBuckets, source: WeeklyBuckets) {
  WEEKLY_BUCKET_KEYS.forEach((key) => {
    target[key] += source[key] || 0;
  });
}

function bucketsOfRow(row: WeeklySnapshotRow): WeeklyBuckets {
  return {
    under50: row.bucket_under50 || 0,
    r50_70: row.bucket_50_70 || 0,
    r70_75: row.bucket_70_75 || 0,
    r75_85: row.bucket_75_85 || 0,
    over85: row.bucket_85_over || 0,
  };
}

/**
 * SKU → CM. 매핑 테이블이 우선이고, 없으면 카테고리 기본값으로 떨어진다.
 *
 * ⚠️ 상품(H01)만 예외로 매핑보다 앞선다. `snop_cm_mapping` 은 CM1~CM3 만 담을 수 있어(체크 제약)
 * 상품 SKU 가 거기 등록돼 있으면 생산 CM 행으로 딸려 들어가기 때문이다.
 */
export function resolveCm(
  materialCode: string,
  category: WeeklyCategory,
  cmMapping: Map<string, WeeklyCm>
): WeeklyCm {
  if (category === '상품') return '상품';
  return cmMapping.get(materialCode) || cmOfCategory(category);
}

/**
 * 적재된 행의 카테고리·공장을 **저장값이 아니라 `dispo`(+ 자재코드) 원본에서 다시 판정**한다.
 *
 * 적재 시점의 매핑으로 굳은 `category`/`plant` 열을 그대로 쓰면, 매핑을 넓혀도 과거 주차는
 * 옛 분류로 남아 주차 간 비교(전주 대비)가 어긋난다. 판정 기준은 항상 지금의
 * `lib/weekly/classification.ts` 하나여야 한다 — 저장 열은 조회 편의용 비정규화일 뿐이다.
 * DISPO 가 없는 SKU 의 한시 매핑(`category-overrides`)도 같은 이유로 여기서 적용된다 —
 * 매핑표에 줄을 더하면 재적재 없이 과거 주차까지 그 자리로 옮겨간다.
 */
function classifyRow(row: WeeklySnapshotRow) {
  const category = categoryOfMaterial(row.material_code, row.dispo);
  return { category, plant: plantOfCategory(category) };
}

export interface BuildWeeklyBoardInput {
  current: WeeklySnapshotRow[];
  previous: WeeklySnapshotRow[];
  cmMapping: Map<string, WeeklyCm>;
  /** 켜져 있는 창고 그룹. 비우면 전부 */
  scopes: WeeklyStorageScope[];
}

export interface WeeklyBoardResult {
  /**
   * 전주 스냅샷이 있는지.
   *
   * 없으면 전주 재고가 0 이 되어 「전주 대비」·「대차 차이」가 전부 당주 재고 전액으로 튄다.
   * 그걸 실제 증감처럼 보여주면 안 되므로 화면은 이 값이 false 일 때 해당 칸을 비운다.
   */
  hasPrevious: boolean;
  rows: WeeklyBoardRow[];
  totals: WeeklyBoardTotals;
  movement: WeeklyBucketMovement;
  /** 카테고리별 구간 재고금액 — 차트는 이 값을 그대로 쓴다(별도 소스 없음) */
  categoryBuckets: { category: WeeklyCategory; buckets: WeeklyBuckets; total: number }[];
  /** 카테고리 축에 못 담긴 DISPO 별 재고금액. 매핑 누락을 금액으로 드러낸다 */
  unmappedDispo: { dispo: string; value: number; itemCount: number }[];
  /**
   * DISPO 가 없어 한시 매핑표(`category-overrides`)로 카테고리를 받은 재고.
   *
   * 기준정보가 아니라 손으로 적은 값이므로 **금액을 화면에 그대로 드러낸다** —
   * 이 장표의 다른 판정 기준과 같은 원칙이다. 정비가 끝나 DISPO 가 붙으면 0 으로 줄어든다.
   */
  overrideMapped: { value: number; itemCount: number };
}

/* ------------------------------------------------------------------ */
/* 축 공용 집계 코어                                                      */
/*                                                                      */
/* 팀별(CM×공장×카테고리)과 채널별(제품계층 LV2) 두 축이 이 함수들을 공유한다.  */
/* 묶는 키만 다르고 더하는 방식·비율·대차는 완전히 같아야 두 탭의 합계가 일치한다. */
/* ------------------------------------------------------------------ */

const emptyMetrics = (): WeeklyBoardMetrics => ({
  previousStockValue: 0,
  shippedValue: 0,
  producedValue: 0,
  stockValue: 0,
  buckets: createWeeklyBuckets(),
  shipmentMtd: 0,
  salesMtd: 0,
  stockToShipmentRatio: null,
  stockToSalesRatio: null,
  balanceGap: 0,
});

const emptyRow = (cm: WeeklyCm, plant: WeeklyPlant, category: WeeklyCategory): WeeklyBoardRow => ({
  cm,
  plant,
  category,
  ...emptyMetrics(),
});

/** 당주 행 하나를 누적. 전주 행은 `previousStockValue` 만 더하므로 호출부에서 따로 처리한다 */
function accumulateCurrent(target: WeeklyBoardMetrics, row: WeeklySnapshotRow) {
  target.stockValue += row.stock_value || 0;
  target.shippedValue += row.shipped_value || 0;
  target.producedValue += row.produced_value || 0;
  target.shipmentMtd += row.shipped_mtd_value || 0;
  target.salesMtd += row.sales_mtd || 0;
  addBuckets(target.buckets, bucketsOfRow(row));
}

/** 누적이 끝난 값에 비율·대차를 채운다 */
function finalizeMetrics<T extends WeeklyBoardMetrics>(row: T): T {
  return {
    ...row,
    stockToShipmentRatio: row.shipmentMtd > 0 ? row.stockValue / row.shipmentMtd : null,
    stockToSalesRatio: row.salesMtd > 0 ? row.stockValue / row.salesMtd : null,
    balanceGap: row.previousStockValue + row.producedValue - row.shippedValue - row.stockValue,
  };
}

/** 재고도 흐름도 전혀 없는 조합은 표를 늘리기만 한다 */
function hasAnyValue(row: WeeklyBoardMetrics) {
  return (
    row.stockValue !== 0 ||
    row.previousStockValue !== 0 ||
    row.shippedValue !== 0 ||
    row.producedValue !== 0
  );
}

/** 표 합계. 행에서 다시 더하므로 표에 보이는 숫자와 구조적으로 일치한다 */
function totalsOf(rows: WeeklyBoardMetrics[]): WeeklyBoardTotals {
  const totals: WeeklyBoardTotals = {
    ...emptyMetrics(),
    rowCount: rows.length,
    previousStockValue: rows.reduce((sum, row) => sum + row.previousStockValue, 0),
    shippedValue: rows.reduce((sum, row) => sum + row.shippedValue, 0),
    producedValue: rows.reduce((sum, row) => sum + row.producedValue, 0),
    stockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
    shipmentMtd: rows.reduce((sum, row) => sum + row.shipmentMtd, 0),
    salesMtd: rows.reduce((sum, row) => sum + row.salesMtd, 0),
  };
  rows.forEach((row) => addBuckets(totals.buckets, row.buckets));
  return { ...finalizeMetrics(totals), rowCount: rows.length };
}

/**
 * 구간별 주간 재고변동 표.
 *
 * 전주 구간액은 전주 스냅샷에서 그대로 접는다. 원본 엑셀은 이 표의 합계가 상단 표와
 * 어긋나 있었는데(계산오류), 같은 원천을 쓰면 구조적으로 일치한다.
 */
function bucketMovementOf(
  previousBuckets: WeeklyBuckets,
  currentBuckets: WeeklyBuckets
): WeeklyBucketMovement {
  const delta = createWeeklyBuckets();
  const rate = createWeeklyBuckets();
  WEEKLY_BUCKET_KEYS.forEach((key) => {
    delta[key] = currentBuckets[key] - previousBuckets[key];
    rate[key] = previousBuckets[key] > 0 ? delta[key] / previousBuckets[key] : 0;
  });

  const previousTotal = sumBuckets(previousBuckets);
  const currentTotal = sumBuckets(currentBuckets);

  return {
    previous: previousBuckets,
    current: currentBuckets,
    delta,
    rate,
    previousTotal,
    currentTotal,
    deltaTotal: currentTotal - previousTotal,
    rateTotal: previousTotal > 0 ? (currentTotal - previousTotal) / previousTotal : 0,
  };
}

export function buildWeeklyBoard({
  current,
  previous,
  cmMapping,
  scopes,
}: BuildWeeklyBoardInput): WeeklyBoardResult {
  const scopeSet = scopes.length ? new Set(scopes) : null;
  const inScope = (row: WeeklySnapshotRow) => !scopeSet || scopeSet.has(row.storage_scope);

  const byKey = new Map<string, WeeklyBoardRow>();
  const unmapped = new Map<string, { value: number; codes: Set<string> }>();
  const overridden = { value: 0, codes: new Set<string>() };

  const keyOf = (cm: WeeklyCm, plant: WeeklyPlant, category: WeeklyCategory) =>
    `${cm}|${plant}|${category}`;

  const touch = (row: WeeklySnapshotRow) => {
    const { category, plant } = classifyRow(row);
    const cm = resolveCm(row.material_code, category, cmMapping);
    const key = keyOf(cm, plant, category);
    let target = byKey.get(key);
    if (!target) {
      target = emptyRow(cm, plant, category);
      byKey.set(key, target);
    }
    return target;
  };

  previous.filter(inScope).forEach((row) => {
    touch(row).previousStockValue += row.stock_value || 0;
  });

  current.filter(inScope).forEach((row) => {
    accumulateCurrent(touch(row), row);

    if (categoryOfDispo(row.dispo) === '기타' && isOverriddenMaterial(row.material_code)) {
      // DISPO 없이 한시 매핑표로 자리를 잡은 몫. 「미매핑」에서 빠진 대신 여기로 드러난다.
      overridden.value += row.stock_value || 0;
      overridden.codes.add(row.material_code);
    }

    if (classifyRow(row).category === '기타') {
      // 「마스터없음」이 아니라 「마스터정비」다 — 데이터가 빠진 게 아니라
      // 생산 플랜트 기준정보를 아직 정비 중인 SKU 라는 뜻이다(대부분 판매법인 영업 코드).
      const dispo = row.dispo || '(마스터정비)';
      const bucket = unmapped.get(dispo) || { value: 0, codes: new Set<string>() };
      bucket.value += row.stock_value || 0;
      bucket.codes.add(row.material_code);
      unmapped.set(dispo, bucket);
    }
  });

  const rows = [...byKey.values()]
    .map(finalizeMetrics)
    .filter(hasAnyValue)
    .sort((a, b) => rowSortWeight(a.cm, a.category) - rowSortWeight(b.cm, b.category));

  const totals = totalsOf(rows);

  const previousBuckets = createWeeklyBuckets();
  previous.filter(inScope).forEach((row) => addBuckets(previousBuckets, bucketsOfRow(row)));

  const categoryTotals = new Map<WeeklyCategory, WeeklyBuckets>();
  rows.forEach((row) => {
    const target = categoryTotals.get(row.category) || createWeeklyBuckets();
    addBuckets(target, row.buckets);
    categoryTotals.set(row.category, target);
  });

  return {
    hasPrevious: previous.length > 0,
    rows,
    totals,
    movement: bucketMovementOf(previousBuckets, totals.buckets),
    categoryBuckets: WEEKLY_CATEGORY_ORDER.map((category) => {
      const buckets = categoryTotals.get(category) || createWeeklyBuckets();
      return { category, buckets, total: sumBuckets(buckets) };
    }).filter((entry) => entry.total > 0),
    unmappedDispo: [...unmapped.entries()]
      .map(([dispo, bucket]) => ({ dispo, value: bucket.value, itemCount: bucket.codes.size }))
      .sort((a, b) => b.value - a.value),
    overrideMapped: { value: overridden.value, itemCount: overridden.codes.size },
  };
}

/* ------------------------------------------------------------------ */
/* 채널별 축 — 제품계층 LV2                                              */
/* ------------------------------------------------------------------ */

export interface BuildWeeklyChannelBoardInput {
  current: WeeklySnapshotRow[];
  previous: WeeklySnapshotRow[];
  /**
   * 자재코드 → 제품계층 LV2(`PRDHA_2_T`). `snop_material_hierarchy` 에서 읽어 넘긴다.
   *
   * ⚠️ 스냅샷 열이 아니라 **조회 시점의 마스터**다. 그래서 마스터를 갱신하면
   * 이미 적재된 과거 주차까지 같은 채널로 다시 접힌다 — 팀별 축이 `dispo` 원본에서
   * 카테고리를 다시 판정하는 것과 같은 원칙이다.
   */
  lv2Map: Map<string, string>;
  scopes: WeeklyStorageScope[];
}

export interface WeeklyChannelBoardResult {
  hasPrevious: boolean;
  rows: WeeklyChannelRow[];
  totals: WeeklyBoardTotals;
  movement: WeeklyBucketMovement;
  /** 채널별 구간 재고금액 — 차트가 그대로 쓴다 */
  channelBuckets: { channel: WeeklyChannel; buckets: WeeklyBuckets; total: number }[];
  /**
   * 채널 매핑표에 없는 LV2 별 재고금액.
   *
   * 팀별 축의 `unmappedDispo` 와 같은 역할이다 — 분류가 안 된 금액을 숨기지 않고 드러낸다.
   * `lib/weekly/channel.ts` 에 줄을 더하면 재적재 없이 과거 주차까지 함께 옮겨간다.
   */
  unmappedLv2: { lv2: string; value: number; itemCount: number }[];
  /**
   * 제품계층 마스터에 아예 없는 SKU 의 재고금액.
   *
   * 「매핑이 빠졌다」와 「마스터를 아직 동기화하지 않았다」는 원인이 달라 따로 센다.
   * 이 값이 전액이면 `snop_material_hierarchy` 가 비어 있다는 뜻이다(적재 한 번이면 채워진다).
   */
  missingHierarchy: { value: number; itemCount: number };
}

/**
 * 채널별 표를 접는다.
 *
 * ⚠️ **팀별 표와 같은 집계 코어(`accumulateCurrent`·`totalsOf`·`bucketMovementOf`)를 쓴다.**
 * 같은 재고를 다르게 묶은 것뿐이므로 두 탭의 합계는 원 단위까지 같아야 한다.
 * 여기서만 다른 필터를 걸거나 따로 더하기 시작하면 두 숫자가 갈려
 * 사용자가 어느 쪽을 믿어야 할지 알 수 없게 된다(`verify:weekly` [7]이 이 일치를 지킨다).
 */
export function buildWeeklyChannelBoard({
  current,
  previous,
  lv2Map,
  scopes,
}: BuildWeeklyChannelBoardInput): WeeklyChannelBoardResult {
  const scopeSet = scopes.length ? new Set(scopes) : null;
  const inScope = (row: WeeklySnapshotRow) => !scopeSet || scopeSet.has(row.storage_scope);

  const byChannel = new Map<WeeklyChannel, WeeklyChannelRow>();
  const unmapped = new Map<string, { value: number; codes: Set<string> }>();
  const missing = { value: 0, codes: new Set<string>() };

  const channelOf = (row: WeeklySnapshotRow) => channelOfLv2(lv2Map.get(row.material_code));

  const touch = (row: WeeklySnapshotRow) => {
    const channel = channelOf(row);
    let target = byChannel.get(channel);
    if (!target) {
      target = { channel, ...emptyMetrics() };
      byChannel.set(channel, target);
    }
    return target;
  };

  previous.filter(inScope).forEach((row) => {
    touch(row).previousStockValue += row.stock_value || 0;
  });

  current.filter(inScope).forEach((row) => {
    accumulateCurrent(touch(row), row);

    if (channelOf(row) !== '미분류') return;

    const lv2 = String(lv2Map.get(row.material_code) ?? '').trim();
    if (!lv2) {
      // 마스터에 없는 SKU. 매핑 누락과 원인이 다르므로 섞지 않는다.
      missing.value += row.stock_value || 0;
      missing.codes.add(row.material_code);
      return;
    }
    const bucket = unmapped.get(lv2) || { value: 0, codes: new Set<string>() };
    bucket.value += row.stock_value || 0;
    bucket.codes.add(row.material_code);
    unmapped.set(lv2, bucket);
  });

  const rows = [...byChannel.values()]
    .map(finalizeMetrics)
    .filter(hasAnyValue)
    .sort((a, b) => channelSortWeight(a.channel) - channelSortWeight(b.channel));

  const totals = totalsOf(rows);

  const previousBuckets = createWeeklyBuckets();
  previous.filter(inScope).forEach((row) => addBuckets(previousBuckets, bucketsOfRow(row)));

  const channelTotals = new Map<WeeklyChannel, WeeklyBuckets>();
  rows.forEach((row) => {
    const target = channelTotals.get(row.channel) || createWeeklyBuckets();
    addBuckets(target, row.buckets);
    channelTotals.set(row.channel, target);
  });

  return {
    hasPrevious: previous.length > 0,
    rows,
    totals,
    movement: bucketMovementOf(previousBuckets, totals.buckets),
    channelBuckets: WEEKLY_CHANNEL_ORDER.map((channel) => {
      const buckets = channelTotals.get(channel) || createWeeklyBuckets();
      return { channel, buckets, total: sumBuckets(buckets) };
    }).filter((entry) => entry.total > 0),
    unmappedLv2: [...unmapped.entries()]
      .map(([lv2, bucket]) => ({ lv2, value: bucket.value, itemCount: bucket.codes.size }))
      .sort((a, b) => b.value - a.value),
    missingHierarchy: { value: missing.value, itemCount: missing.codes.size },
  };
}

/**
 * 채널별 탭의 비고 문구. 팀별 문구(`buildStockSummaryNote`)와 같은 틀이고 나열 축만 채널이다.
 */
export function buildChannelStockSummaryNote(result: WeeklyChannelBoardResult) {
  const { totals, rows } = result;

  if (!result.hasPrevious) {
    const flowDelta = totals.producedValue - totals.shippedValue;
    return [
      `* 전체 재고금액 ${formatNoteAmount(totals.stockValue)}`,
      ' - 전주 스냅샷이 없어 전주 대비 증감은 다음 주차부터 표시됩니다',
      '',
      `* 생산량 대비 출고량 ${formatSignedNoteAmount(-flowDelta)}`,
    ].join('\n');
  }

  const totalDelta = totals.stockValue - totals.previousStockValue;
  const channelText = rows
    .map((row) => ({ channel: row.channel, delta: row.stockValue - row.previousStockValue }))
    .filter((entry) => Math.round(entry.delta) !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((entry) => `${entry.channel} ${formatSignedNoteAmount(entry.delta)}`)
    .join(', ');

  const flowDelta = totals.producedValue - totals.shippedValue;

  const lines = [
    `* 전체 재고금액은 전주 대비 ${formatNoteAmount(totalDelta)} ${totalDelta >= 0 ? '증가' : '감소'}`,
  ];
  if (channelText) lines.push(` - ${channelText}`);
  lines.push('');
  lines.push(
    `* 생산량 대비 출고량 ${formatSignedNoteAmount(-flowDelta)}으로 전체 재고 ${flowDelta >= 0 ? '증가' : '감소'}`
  );

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 금액 표기                                                            */
/* ------------------------------------------------------------------ */

/**
 * 비고 문구에 들어가는 금액 표기.
 *
 * 원본 엑셀은 억·백만·천을 섞어 쓰고 오타도 있었다(`02.4천만원`, `01천`).
 * 여기서 규칙 하나로 고정한다 — 1억 이상은 `n.n억`, 그 미만은 만원 단위.
 */
export function formatNoteAmount(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${(abs / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`;
  return `${Math.round(abs).toLocaleString('ko-KR')}원`;
}

/** 부호를 붙인 표기. 카테고리별 증감 나열에 쓴다 */
export function formatSignedNoteAmount(value: number) {
  if (Math.round(value) === 0) return '0';
  return `${value > 0 ? '+' : '-'}${formatNoteAmount(value)}`;
}

/** 억원 단위 (차트 축) */
export function toEok(value: number) {
  return value / 100_000_000;
}

/* ------------------------------------------------------------------ */
/* 비고 문구 — 고정 텍스트 + 값 치환                                     */
/* ------------------------------------------------------------------ */

/**
 * 원본 엑셀 O4 의 문구를 그대로 옮긴 템플릿.
 * **고정 텍스트는 손대지 않고 금액과 증가/감소만 바뀐다.**
 */
export function buildStockSummaryNote(result: WeeklyBoardResult) {
  const { totals, rows } = result;

  // 전주 스냅샷이 없으면 "전주 대비 140억 증가" 같은 헛문장이 나온다. 그 대신 현황만 적는다.
  if (!result.hasPrevious) {
    const flowDelta = totals.producedValue - totals.shippedValue;
    return [
      `* 전체 재고금액 ${formatNoteAmount(totals.stockValue)}`,
      ' - 전주 스냅샷이 없어 전주 대비 증감은 다음 주차부터 표시됩니다',
      '',
      `* 생산량 대비 출고량 ${formatSignedNoteAmount(-flowDelta)}`,
    ].join('\n');
  }

  const totalDelta = totals.stockValue - totals.previousStockValue;

  const byCategory = new Map<WeeklyCategory, number>();
  rows.forEach((row) => {
    byCategory.set(
      row.category,
      (byCategory.get(row.category) || 0) + (row.stockValue - row.previousStockValue)
    );
  });

  // 원본도 증감 절대값이 큰 순으로 나열돼 있다.
  const categoryText = [...byCategory.entries()]
    .filter(([, delta]) => Math.round(delta) !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([category, delta]) => `${category} ${formatSignedNoteAmount(delta)}`)
    .join(', ');

  const flowDelta = totals.producedValue - totals.shippedValue;

  const lines = [
    `* 전체 재고금액은 전주 대비 ${formatNoteAmount(totalDelta)} ${totalDelta >= 0 ? '증가' : '감소'}`,
  ];
  if (categoryText) lines.push(` - ${categoryText}`);
  lines.push('');
  lines.push(
    `* 생산량 대비 출고량 ${formatSignedNoteAmount(-flowDelta)}으로 전체 재고 ${flowDelta >= 0 ? '증가' : '감소'}`
  );

  return lines.join('\n');
}

/** 원본 엑셀 N13 의 문구 템플릿 — 구간별 재고변동 블록 */
export function buildBucketMovementNote(movement: WeeklyBucketMovement, hasPrevious = true) {
  if (!hasPrevious) {
    return WEEKLY_BUCKET_KEYS.slice(0, 3)
      .map((key) => {
        const label = key === 'under50' ? '소비기한 50% 미만 재고' : `${WEEKLY_BUCKET_LABELS[key].split(' ')[0]} 구간 재고`;
        return `* ${label} ${formatNoteAmount(movement.current[key])}`;
      })
      .join('\n')
      .concat('\n\n* 전주 대비 증감은 다음 주차가 적재되면 표시됩니다');
  }

  return WEEKLY_BUCKET_KEYS.slice(0, 3)
    .map((key) => {
      const delta = movement.delta[key];
      const label = key === 'under50' ? '소비기한 50% 미만 재고' : `${WEEKLY_BUCKET_LABELS[key].split(' ')[0]} 구간 재고`;
      return `* ${label} ${formatNoteAmount(delta)} ${delta >= 0 ? '증가' : '감소'}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* 카테고리 드릴다운 — SKU 상세                                          */
/* ------------------------------------------------------------------ */

/**
 * 상세표 한 줄 = SKU 하나.
 *
 * 적재는 SKU × 창고그룹이라 같은 SKU 가 플랜트·물류에 나뉘어 있다. 여기서 **켜진 스코프만** 접는다.
 * 출고·생산은 적재 때 SKU 당 한 스코프에만 실려 있으므로(중복 합산 방지) 그냥 더하면 된다.
 */
export interface WeeklyDetailRow {
  materialCode: string;
  productName: string;
  dispo: string | null;
  cm: WeeklyCm;
  plant: WeeklyPlant;
  category: WeeklyCategory;
  /** 제품계층 LV2(`PRDHA_2_T`). 마스터에 없으면 null */
  lv2: string | null;
  /** LV2 로 판정한 판매 채널. 팀별 축으로 펼쳐도 함께 보여 두 축을 한 줄에서 대조할 수 있다 */
  channel: WeeklyChannel;
  unit: string;
  stockQty: number;
  stockValue: number;
  previousStockValue: number;
  /** 전주 대비 재고금액 증감. 전주 스냅샷이 없으면 null */
  stockDelta: number | null;
  buckets: WeeklyBuckets;
  /** 잔여율 구간별 재고수량. 열 추가 전 주차는 모두 0 이다 */
  bucketQuantities: WeeklyBuckets;
  /** 이 SKU 의 구간수량 합이 재고수량과 맞는지 */
  hasBucketQuantities: boolean;
  /** 잔여율 75% 미만(50%미만 + 50~70% + 70~75%) 재고금액 = 소진 필요 */
  riskValue: number;
  riskRatio: number;
  shippedQty: number;
  shippedValue: number;
  producedQty: number;
  producedValue: number;
  shipmentMtd: number;
  stockToShipmentRatio: number | null;
  unitPrice: number;
  priceMonth: string | null;
  priceSource: string;
  /** 가장 임박한 배치의 잔여일. 열이 없던 주차·기한없음 재고는 null */
  minRemainDay: number | null;
  /** 금액 가중 평균 잔여율(%). 없으면 null */
  avgRemainRate: number | null;
  /** 재고가 실려 있는 창고그룹들. 어디에 쌓여 있는지 한 줄에서 보이게 한다 */
  scopes: WeeklyStorageScope[];
}

function bucketQuantitiesOfRow(row: WeeklySnapshotRow): WeeklyBuckets {
  return {
    under50: row.bucket_qty_under50 || 0,
    r50_70: row.bucket_qty_50_70 || 0,
    r70_75: row.bucket_qty_70_75 || 0,
    r75_85: row.bucket_qty_75_85 || 0,
    over85: row.bucket_qty_85_over || 0,
  };
}

export interface BuildWeeklyDetailInput extends BuildWeeklyBoardInput {
  /** 이 카테고리만. 비우면 전부 */
  category?: WeeklyCategory | null;
  /** 이 CM 만. 카테고리와 함께 주면 메인 표의 그 한 줄과 정확히 같은 모수가 된다 */
  cm?: WeeklyCm | null;
  /**
   * 자재코드 → 제품계층 LV2. 채널 열·채널 필터의 원천이다.
   * 없으면 채널이 전부 `미분류` 로 나오므로 채널 드릴다운에서는 반드시 넘겨야 한다.
   */
  lv2Map?: Map<string, string>;
  /** 이 채널만. 채널별 표의 한 줄을 펼칠 때 쓴다 */
  channel?: WeeklyChannel | null;
}

export interface WeeklyDetailResult {
  rows: WeeklyDetailRow[];
  hasPrevious: boolean;
  /** 상세표 합계. 메인 표의 해당 줄과 일치해야 한다 */
  totals: {
    stockValue: number;
    previousStockValue: number;
    riskValue: number;
    buckets: WeeklyBuckets;
    shippedValue: number;
    producedValue: number;
    itemCount: number;
  };
  /** 잔여일 열이 채워진 주차인지. false 면 「소비기한 임박」 정렬을 쓸 수 없다 */
  hasRemainDay: boolean;
  /** 구간별 수량 열이 정확히 채워진 주차인지. false 면 수량은 '-' 로 표시한다 */
  hasBucketQuantities: boolean;
  /** 구간수량을 역산할 수 없는 SKU 수 */
  missingBucketQuantityCount: number;
}

/** 소진 필요 = 잔여율 75% 미만. 메인 표의 「소진 필요」와 같은 정의다 */
export const WEEKLY_RISK_BUCKET_KEYS: (keyof WeeklyBuckets)[] = ['under50', 'r50_70', 'r70_75'];

function riskValueOf(buckets: WeeklyBuckets) {
  return WEEKLY_RISK_BUCKET_KEYS.reduce((sum, key) => sum + (buckets[key] || 0), 0);
}

/**
 * 카테고리(또는 CM×카테고리) 한 칸을 SKU 단위로 펼친다.
 *
 * 분류는 메인 표와 **같은 `classifyRow`·`resolveCm`** 을 쓴다. 여기서만 다르게 판정하면
 * 합계가 위 표와 어긋나 어느 쪽을 믿어야 할지 알 수 없게 된다.
 */
export function buildWeeklyDetail({
  current,
  previous,
  cmMapping,
  scopes,
  category = null,
  cm = null,
  lv2Map,
  channel = null,
}: BuildWeeklyDetailInput): WeeklyDetailResult {
  const lv2Of = (materialCode: string) => {
    const value = String(lv2Map?.get(materialCode) ?? '').trim();
    return value || null;
  };
  const scopeSet = scopes.length ? new Set(scopes) : null;
  const inScope = (row: WeeklySnapshotRow) => !scopeSet || scopeSet.has(row.storage_scope);

  const byCode = new Map<string, WeeklyDetailRow>();
  /** 잔여율 가중평균용 누적 — (잔여율 × 금액) 합과 금액 합 */
  const rateAccum = new Map<string, { weighted: number; weight: number }>();
  let hasRemainDay = false;

  const matches = (row: WeeklySnapshotRow) => {
    const rowCategory = categoryOfMaterial(row.material_code, row.dispo);
    if (category && rowCategory !== category) return false;
    if (cm && resolveCm(row.material_code, rowCategory, cmMapping) !== cm) return false;
    // 채널 필터는 메인 채널 표와 **같은 판정 함수**를 쓴다. 여기서만 다르게 걸면 합계가 갈린다.
    if (channel && channelOfLv2(lv2Of(row.material_code)) !== channel) return false;
    return true;
  };

  const touch = (row: WeeklySnapshotRow) => {
    const rowCategory = categoryOfMaterial(row.material_code, row.dispo);
    let target = byCode.get(row.material_code);
    if (!target) {
      target = {
        materialCode: row.material_code,
        productName: row.product_name || row.material_code,
        dispo: row.dispo,
        cm: resolveCm(row.material_code, rowCategory, cmMapping),
        plant: plantOfCategory(rowCategory),
        category: rowCategory,
        lv2: lv2Of(row.material_code),
        channel: channelOfLv2(lv2Of(row.material_code)),
        unit: row.unit || 'EA',
        stockQty: 0,
        stockValue: 0,
        previousStockValue: 0,
        stockDelta: null,
        buckets: createWeeklyBuckets(),
        bucketQuantities: createWeeklyBuckets(),
        hasBucketQuantities: false,
        riskValue: 0,
        riskRatio: 0,
        shippedQty: 0,
        shippedValue: 0,
        producedQty: 0,
        producedValue: 0,
        shipmentMtd: 0,
        stockToShipmentRatio: null,
        unitPrice: row.unit_price || 0,
        priceMonth: row.price_month || null,
        priceSource: row.price_source || 'UNKNOWN',
        minRemainDay: null,
        avgRemainRate: null,
        scopes: [],
      };
      byCode.set(row.material_code, target);
    }
    return target;
  };

  previous
    .filter((row) => inScope(row) && matches(row))
    .forEach((row) => {
      touch(row).previousStockValue += row.stock_value || 0;
    });

  current
    .filter((row) => inScope(row) && matches(row))
    .forEach((row) => {
      const target = touch(row);
      // 이름·단가는 재고가 있는 행의 값을 우선한다(흐름만 있는 행은 이름이 코드일 수 있다).
      if (row.stock_value > 0) {
        target.productName = row.product_name || target.productName;
        target.unitPrice = row.unit_price || target.unitPrice;
        target.priceMonth = row.price_month || target.priceMonth;
        target.priceSource = row.price_source || target.priceSource;
      }
      target.stockQty += row.stock_qty || 0;
      target.stockValue += row.stock_value || 0;
      target.shippedQty += row.shipped_qty || 0;
      target.shippedValue += row.shipped_value || 0;
      target.producedQty += row.produced_qty || 0;
      target.producedValue += row.produced_value || 0;
      target.shipmentMtd += row.shipped_mtd_value || 0;
      addBuckets(target.buckets, bucketsOfRow(row));
      const bucketQuantities = bucketQuantitiesOfRow(row);
      addBuckets(target.bucketQuantities, bucketQuantities);
      if ((row.stock_value || 0) > 0 && !target.scopes.includes(row.storage_scope)) {
        target.scopes.push(row.storage_scope);
      }

      const remainDay = row.min_remain_day;
      if (remainDay !== null && remainDay !== undefined && Number.isFinite(Number(remainDay))) {
        hasRemainDay = true;
        const value = Number(remainDay);
        target.minRemainDay =
          target.minRemainDay === null ? value : Math.min(target.minRemainDay, value);
      }

      const rate = row.avg_remain_rate;
      if (rate !== null && rate !== undefined && Number.isFinite(Number(rate))) {
        const weight = row.stock_value || 0;
        if (weight > 0) {
          const accum = rateAccum.get(row.material_code) || { weighted: 0, weight: 0 };
          accum.weighted += Number(rate) * weight;
          accum.weight += weight;
          rateAccum.set(row.material_code, accum);
        }
      }
    });

  const rows = [...byCode.values()]
    .map((row) => {
      const riskValue = riskValueOf(row.buckets);
      const accum = rateAccum.get(row.materialCode);
      const bucketQuantityTotal = sumBuckets(row.bucketQuantities);
      const quantityTolerance = Math.max(0.01, Math.abs(row.stockQty) * 1e-6);
      return {
        ...row,
        hasBucketQuantities:
          row.stockQty === 0 || Math.abs(row.stockQty - bucketQuantityTotal) <= quantityTolerance,
        riskValue,
        riskRatio: row.stockValue > 0 ? riskValue / row.stockValue : 0,
        stockDelta: previous.length > 0 ? row.stockValue - row.previousStockValue : null,
        stockToShipmentRatio: row.shipmentMtd > 0 ? row.stockValue / row.shipmentMtd : null,
        avgRemainRate: accum && accum.weight > 0 ? accum.weighted / accum.weight : null,
        scopes: row.scopes.sort(),
      };
    })
    // 재고도 흐름도 없는 SKU 는 표를 늘리기만 한다
    .filter(
      (row) =>
        row.stockValue !== 0 ||
        row.previousStockValue !== 0 ||
        row.shippedValue !== 0 ||
        row.producedValue !== 0
    )
    .sort((a, b) => b.stockValue - a.stockValue);

  return {
    rows,
    hasPrevious: previous.length > 0,
    hasRemainDay,
    // 과거 주차는 새 열의 기본값이 0 이다. SKU 별로 합계를 맞춰 일부 구형 행도 정확히 구분한다.
    hasBucketQuantities: rows.some((row) => row.stockQty > 0 && row.hasBucketQuantities),
    missingBucketQuantityCount: rows.filter(
      (row) => row.stockQty > 0 && !row.hasBucketQuantities
    ).length,
    totals: {
      stockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
      previousStockValue: rows.reduce((sum, row) => sum + row.previousStockValue, 0),
      riskValue: rows.reduce((sum, row) => sum + row.riskValue, 0),
      buckets: rows.reduce((total, row) => {
        addBuckets(total, row.buckets);
        return total;
      }, createWeeklyBuckets()),
      shippedValue: rows.reduce((sum, row) => sum + row.shippedValue, 0),
      producedValue: rows.reduce((sum, row) => sum + row.producedValue, 0),
      itemCount: rows.length,
    },
  };
}
