/**
 * 재고 통합 장표(현황 + 분석) 행 생성 — I/O 없는 순수 함수
 *
 * 예전에는 같은 재고 데이터를 두 화면이 따로 계산했다.
 *   /stock     배치 단위 (유통기한 · 잔여일 · 위치)
 *   /inventory 품목 단위 (ADS · 회전일 · 잔여율 구간)
 * 회전일을 보려고 페이지를 옮기고 연령을 보려고 되돌아오는 구조였고,
 * 무엇보다 폐기 판정이 두 곳에서 서로 달랐다.
 * 그래서 판정·집계를 여기 한 곳으로 모으고 화면은 표시만 한다.
 *
 * 되돌리면 안 되는 결정 두 가지:
 *  1) 배치 상태 판정은 lib/inventory-status.ts 의 classifyInventoryStatus 하나만 쓴다.
 *     (예전 /inventory 는 '6' 으로 시작하는 상품을 무조건 기한없음으로 봐서
 *      같은 배치가 재고현황에서는 폐기, 재고분석에서는 가용으로 잡혔다.)
 *  2) 기한없음 재고는 잔여율 구간(~50% 등)에 넣지 않고 별도 구간으로 뺀다.
 *     플랜트 기한없음 배치는 remain_rate 가 0 으로 들어와 전부 '~50%' 로 오분류됐다.
 */

import type { DashboardAnalysis, IntegratedItem, InventoryBatch } from '@/types/analysis';
import type { InventoryStockType, InventoryStockTypeFilter } from '@/lib/inventory-classification';
import { classifyInventoryStatus, type InventoryRiskStatus } from '@/lib/inventory-status';
import type { PriceSource } from '@/lib/ending-inventory-price';

export type InventoryViewMode = 'ALL' | 'PLANT' | 'LOGISTICS';

/** 화면에 뿌리는 행 상태. 품질대기는 유통기한 판정 대상이 아니라 별도 값이다. */
export type InventoryBoardStatus = InventoryRiskStatus | 'quality_hold';

/** 상태 탭 필터 값 */
export type InventoryStatusFilter = 'all' | InventoryRiskStatus;

/** 잔여율 구간. noExpiry 는 '기한없음' 재고 전용 칸이다. */
export interface InventoryBoardBuckets {
  under50: number;
  r50_70: number;
  r70_75: number;
  r75_85: number;
  over85: number;
  noExpiry: number;
}

export type InventoryStatusQty = Record<InventoryRiskStatus, number>;

/** 배치(소비기한) 단위 행 — 예전 재고현황 탭의 한 줄 */
export interface InventoryBoardBatchRow {
  code: string;
  name: string;
  unit: string;
  umrezBox: number;
  quantity: number;
  status: InventoryBoardStatus;
  expirationDateStr: string;
  /** 기한없음이면 null */
  remainDays: number | null;
  /** 기한없음이면 null */
  remainRate: number | null;
  location: string;
  source: 'PLANT' | 'FBH';
  stockType: InventoryStockType;
  dispo?: string;
  productionLine: string | null;
  stockValue: number;
  priceSource: PriceSource;
  /** 품질대기(검사중) 수량 행 여부 */
  isQuality: boolean;
}

/** 품목 단위 행 — 예전 재고분석 탭의 한 줄 + 유통기한 요약 */
export interface InventoryBoardItemRow {
  code: string;
  name: string;
  unit: string;
  umrezBox: number;

  ads30: number;
  ads60: number;
  ads90: number;

  usableStock: number;
  wasteStock: number;
  qualityStock: number;
  stockValue: number;
  qualityStockValue: number;
  priceSource: PriceSource;
  turnoverDays: number;
  targetDatePlan: number;

  /** 유통기한이 있는 배치 중 가장 짧은 잔여일. 전부 기한없음이면 null */
  minRemainDays: number | null;
  statusQty: InventoryStatusQty;

  buckets: InventoryBoardBuckets;
  bucketValues: InventoryBoardBuckets;

  stockTypes: InventoryStockType[];
  dispoCodes: string[];
  productionLines: string[];

  /** 이 품목에 속한 배치 행 (펼침 영역에 그대로 쓴다) */
  batches: InventoryBoardBatchRow[];
}

export interface InventoryBoardSummary {
  /** 기말재고 단가가 붙은 배치의 재고금액 합 */
  totalValue: number;
  /** 폐기·임박 배치의 재고금액 합 */
  riskValue: number;
  itemCount: number;
  batchRowCount: number;
  pricedItemCount: number;
  currentMonthItemCount: number;
  totalAds30: number;
  totalAds60: number;
  totalAds90: number;
  statusQty: InventoryStatusQty;
}

export interface InventoryBoardOptions {
  viewMode: InventoryViewMode;
  stockType: InventoryStockTypeFilter;
  productionLine: string;
  statusFilter: InventoryStatusFilter;
  searchTerm: string;
  favoritesOnly: boolean;
  isFavorite?: (code: string) => boolean;
  /** 품질대기 재고를 행·컬럼으로 노출할지 */
  showQuality: boolean;
  /** 품질대기 재고를 가용재고에 합산할지 */
  includeQualityInUsable: boolean;
  /** 생산계획 컬럼의 기준일 (yyyy-MM-dd) */
  targetDate: string;
}

export interface InventoryBoardResult {
  items: InventoryBoardItemRow[];
  batches: InventoryBoardBatchRow[];
  summary: InventoryBoardSummary;
}

export const INVENTORY_BOARD_STATUS_LABELS: Record<InventoryBoardStatus, string> = {
  disposed: '폐기',
  imminent: '임박',
  critical: '긴급',
  healthy: '양호',
  no_expiry: '기한없음',
  quality_hold: '품질대기',
};

/** 잔여일 짧은 순으로 보여주기 위한 정렬 가중치 */
export const INVENTORY_STATUS_ORDER: InventoryRiskStatus[] = [
  'disposed',
  'imminent',
  'critical',
  'healthy',
  'no_expiry',
];

const createBuckets = (): InventoryBoardBuckets => ({
  under50: 0,
  r50_70: 0,
  r70_75: 0,
  r75_85: 0,
  over85: 0,
  noExpiry: 0,
});

const createStatusQty = (): InventoryStatusQty => ({
  disposed: 0,
  imminent: 0,
  critical: 0,
  healthy: 0,
  no_expiry: 0,
});

function pickBatches(item: IntegratedItem, viewMode: InventoryViewMode): InventoryBatch[] {
  if (viewMode === 'PLANT') return item.inventory.plantBatches || [];
  if (viewMode === 'LOGISTICS') return item.inventory.fbhBatches || [];
  return item.inventory.batches || [];
}

/** 잔여율을 구간 키로 바꾼다. 폐기·기한없음은 여기 들어오지 않는다. */
function bucketKeyOf(remainRate: number): keyof InventoryBoardBuckets {
  if (remainRate < 50) return 'under50';
  if (remainRate < 70) return 'r50_70';
  if (remainRate < 75) return 'r70_75';
  if (remainRate < 85) return 'r75_85';
  return 'over85';
}

export function buildInventoryBoard(
  data: DashboardAnalysis,
  options: InventoryBoardOptions
): InventoryBoardResult {
  const {
    viewMode,
    stockType,
    productionLine,
    statusFilter,
    searchTerm,
    favoritesOnly,
    isFavorite,
    showQuality,
    includeQualityInUsable,
    targetDate,
  } = options;

  const keyword = searchTerm.trim().toLowerCase();
  const quantityMode = viewMode !== 'LOGISTICS';

  // 생산계획(기준일) — 날짜 하나만 보므로 미리 접어둔다
  const planMap = new Map<string, number>();
  (data.productionList || []).forEach((row) => {
    if (row.date !== targetDate) return;
    planMap.set(row.code, (planMap.get(row.code) || 0) + row.planQty);
  });

  const items: InventoryBoardItemRow[] = [];
  const batches: InventoryBoardBatchRow[] = [];

  const summary: InventoryBoardSummary = {
    totalValue: 0,
    riskValue: 0,
    itemCount: 0,
    batchRowCount: 0,
    pricedItemCount: 0,
    currentMonthItemCount: 0,
    totalAds30: 0,
    totalAds60: 0,
    totalAds90: 0,
    statusQty: createStatusQty(),
  };

  (data.integratedArray || []).forEach((item) => {
    if (favoritesOnly && isFavorite && !isFavorite(item.code)) return;
    if (keyword) {
      const matched =
        item.name.toLowerCase().includes(keyword) || item.code.toLowerCase().includes(keyword);
      if (!matched) return;
    }

    const scoped = pickBatches(item, viewMode).filter((batch) => {
      const matchesStockType = stockType === 'ALL' || batch.stockType === stockType;
      const matchesLine = productionLine === 'ALL' || batch.dispo === productionLine;
      return matchesStockType && matchesLine;
    });
    if (scoped.length === 0) return;

    const rows: InventoryBoardBatchRow[] = [];
    const statusQty = createStatusQty();
    const buckets = createBuckets();
    const bucketValues = createBuckets();
    const stockTypeSet = new Set<InventoryStockType>();
    const dispoSet = new Set<string>();
    const lineSet = new Set<string>();

    let usableStock = 0;
    let wasteStock = 0;
    let stockValue = 0;
    let qualityStock = 0;
    let qualityStockValue = 0;
    let riskValue = 0;
    let pricedValue = 0;
    let minRemainDays: number | null = null;
    let hasEndingPrice = false;
    let hasCurrentMonth = false;

    scoped.forEach((batch) => {
      // 품질대기(검사중) 수량은 플랜트 배치에만 붙는다
      const qualityQty = batch.source === 'PLANT' ? batch.qualityQuantity || 0 : 0;
      if (quantityMode && qualityQty > 0) {
        qualityStock += qualityQty;
        qualityStockValue += qualityQty * (batch.valuationUnitPrice || 0);

        // 품질대기 행은 상태 탭(유통기한 판정)의 대상이 아니라 '전체' 에서만 보여준다
        if (showQuality && statusFilter === 'all') {
          rows.push({
            code: item.code,
            name: item.name,
            unit: item.unit,
            umrezBox: item.umrezBox,
            quantity: qualityQty,
            status: 'quality_hold',
            expirationDateStr: batch.expirationDate === '기한없음' ? '-' : batch.expirationDate,
            remainDays: null,
            remainRate: null,
            location: batch.location || '-',
            source: batch.source,
            stockType: batch.stockType,
            dispo: batch.dispo,
            productionLine: batch.productionLine,
            stockValue: qualityQty * (batch.valuationUnitPrice || 0),
            priceSource: batch.priceSource,
            isQuality: true,
          });
        }
      }

      if (batch.quantity <= 0) return;

      const status = classifyInventoryStatus(batch.expirationDate, batch.remainDays);
      if (statusFilter !== 'all' && status !== statusFilter) return;

      const noExpiry = status === 'no_expiry';

      rows.push({
        code: item.code,
        name: item.name,
        unit: item.unit,
        umrezBox: item.umrezBox,
        quantity: batch.quantity,
        status,
        expirationDateStr: noExpiry ? '-' : batch.expirationDate,
        remainDays: noExpiry ? null : batch.remainDays,
        remainRate: noExpiry ? null : batch.remainRate,
        location: batch.location || '-',
        source: batch.source,
        stockType: batch.stockType,
        dispo: batch.dispo,
        productionLine: batch.productionLine,
        stockValue: batch.stockValue,
        priceSource: batch.priceSource,
        isQuality: false,
      });

      statusQty[status] += batch.quantity;
      stockTypeSet.add(batch.stockType);
      if (batch.dispo) dispoSet.add(batch.dispo);
      if (batch.productionLine) lineSet.add(batch.productionLine);

      if (status === 'disposed') wasteStock += batch.quantity;
      else usableStock += batch.quantity;

      stockValue += batch.stockValue;
      if (batch.priceSource === 'ENDING_INVENTORY') {
        hasEndingPrice = true;
        pricedValue += batch.stockValue;
        if (status === 'disposed' || status === 'imminent') riskValue += batch.stockValue;
      } else if (batch.priceSource === 'CURRENT_MONTH') {
        hasCurrentMonth = true;
      }

      if (!noExpiry) {
        minRemainDays =
          minRemainDays === null ? batch.remainDays : Math.min(minRemainDays, batch.remainDays);
      }

      // 잔여율 구간: 폐기는 제외, 기한없음은 전용 칸으로
      if (noExpiry) {
        buckets.noExpiry += batch.quantity;
        bucketValues.noExpiry += batch.stockValue;
      } else if (status !== 'disposed') {
        const key = bucketKeyOf(batch.remainRate);
        buckets[key] += batch.quantity;
        bucketValues[key] += batch.stockValue;
      }
    });

    const hasQualityOnly = rows.length === 0 && qualityStock > 0 && statusFilter === 'all';
    if (rows.length === 0 && !hasQualityOnly) return;

    if (includeQualityInUsable && quantityMode) usableStock += qualityStock;

    const priceSource: PriceSource = hasEndingPrice
      ? 'ENDING_INVENTORY'
      : hasCurrentMonth
        ? 'CURRENT_MONTH'
        : 'UNKNOWN';

    const ads30 = item.inventory.ads30 || 0;
    const ads60 = item.inventory.ads60 || 0;
    const ads90 = item.inventory.ads90 || 0;
    const turnoverDays = ads90 > 0 ? usableStock / ads90 : usableStock > 0 ? 99999 : 0;

    items.push({
      code: item.code,
      name: item.name,
      unit: item.unit,
      umrezBox: item.umrezBox,
      ads30,
      ads60,
      ads90,
      usableStock,
      wasteStock,
      qualityStock: quantityMode ? qualityStock : 0,
      stockValue,
      qualityStockValue: quantityMode ? qualityStockValue : 0,
      priceSource,
      turnoverDays,
      targetDatePlan: planMap.get(item.code) || 0,
      minRemainDays,
      statusQty,
      buckets,
      bucketValues,
      stockTypes: Array.from(stockTypeSet),
      dispoCodes: Array.from(dispoSet).sort(),
      productionLines: Array.from(lineSet),
      batches: rows,
    });

    batches.push(...rows);

    summary.totalValue += pricedValue;
    summary.riskValue += riskValue;
    summary.totalAds30 += ads30;
    summary.totalAds60 += ads60;
    summary.totalAds90 += ads90;
    if (priceSource === 'ENDING_INVENTORY') summary.pricedItemCount += 1;
    else if (priceSource === 'CURRENT_MONTH') summary.currentMonthItemCount += 1;
    INVENTORY_STATUS_ORDER.forEach((key) => {
      summary.statusQty[key] += statusQty[key];
    });
  });

  // 배치 목록은 '가장 위험한 것 먼저'가 기본이다 (기한없음은 맨 뒤)
  batches.sort((a, b) => {
    const aDays = a.remainDays ?? Number.POSITIVE_INFINITY;
    const bDays = b.remainDays ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return a.code.localeCompare(b.code);
  });

  summary.itemCount = items.length;
  summary.batchRowCount = batches.length;

  return { items, batches, summary };
}
