/**
 * MCP 재고 툴이 사용하는 집계 로직.
 *
 * 대시보드가 쓰는 getDashboardData 를 그대로 재사용한다.
 *  - 화면 숫자와 100% 동일해진다 (MCP 답변과 대시보드가 어긋나면 아무도 안 믿는다)
 *  - 이미 unstable_cache(10분) 가 걸려 있어 BigQuery 추가 스캔 비용이 거의 없다
 *  - 재고 평가금액은 기말재고 단가(ending_inventory)가 적용된 값을 그대로 쓴다
 */

import { format, startOfMonth } from 'date-fns';
import { getDashboardData } from '@/actions/dashboard-actions';
import {
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_RULE_TEXT,
  type InventoryRiskStatus,
  classifyInventoryStatus,
  isNoExpiry,
} from '@/lib/inventory-status';
import { INVENTORY_STOCK_TYPE_LABELS } from '@/lib/inventory-classification';
import type { IntegratedItem, InventoryBatch } from '@/types/analysis';

export type GroupDimension = 'brand' | 'category' | 'family' | 'productionLine' | 'stockType';

export const GROUP_DIMENSION_LABELS: Record<GroupDimension, string> = {
  brand: '브랜드(제품계층1)',
  category: '카테고리(제품계층2)',
  family: '제품군(제품계층3)',
  productionLine: '생산라인(MRP관리자)',
  stockType: '재고구분(자소용/판매용/상품)',
};

interface BatchRow {
  code: string;
  name: string;
  unit: string;
  brand: string;
  category: string;
  family: string;
  productionLine: string;
  stockType: string;
  location: string;
  source: 'PLANT' | 'FBH';
  qty: number;
  value: number;
  hasPrice: boolean;
  remainDays: number | null;
  expirationDate: string | null;
  status: InventoryRiskStatus;
}

const round = (n: number) => Math.round(n);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function formatExpiry(raw: string | null | undefined): string | null {
  if (isNoExpiry(raw)) return null;
  const v = String(raw);
  return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
}

/**
 * 대시보드 기본 조회 구간(이번 달 1일 ~ 오늘)을 그대로 쓴다.
 * 재고는 스냅샷이라 기간과 무관하지만, 화면과 같은 캐시 키를 태워야 BigQuery를 다시 긁지 않는다.
 */
function defaultRange() {
  const today = new Date();
  return {
    startDate: format(startOfMonth(today), 'yyyy-MM-dd'),
    endDate: format(today, 'yyyy-MM-dd'),
  };
}

async function loadBatchRows(): Promise<BatchRow[]> {
  const { startDate, endDate } = defaultRange();
  const res = await getDashboardData(startDate, endDate);

  if (!res?.success || !res?.data?.integratedArray) {
    throw new Error(res?.message || '재고 데이터를 불러오지 못했습니다.');
  }

  const rows: BatchRow[] = [];

  (res.data.integratedArray as IntegratedItem[]).forEach((item) => {
    // 통합 재고(플랜트 + 물류센터). 화면 기본값과 동일하다.
    (item.inventory?.batches || []).forEach((b: InventoryBatch) => {
      if (!b || b.quantity <= 0) return;

      rows.push({
        code: item.code,
        name: item.name,
        unit: item.unit || 'EA',
        brand: item.brand || '기타',
        category: item.category || '미지정',
        family: item.family || '기타',
        productionLine: b.productionLine || (b.source === 'FBH' ? '물류센터' : '미지정'),
        stockType: INVENTORY_STOCK_TYPE_LABELS[b.stockType] || '기타',
        location: b.location || '-',
        source: b.source,
        qty: Number(b.quantity) || 0,
        value: b.priceSource === 'ENDING_INVENTORY' ? Number(b.stockValue) || 0 : 0,
        hasPrice: b.priceSource === 'ENDING_INVENTORY',
        remainDays: isNoExpiry(b.expirationDate) ? null : Number(b.remainDays),
        expirationDate: formatExpiry(b.expirationDate),
        status: classifyInventoryStatus(b.expirationDate, Number(b.remainDays)),
      });
    });
  });

  return rows;
}

const BASE_NOTE = {
  기준일: format(new Date(), 'yyyy-MM-dd'),
  재고범위: '플랜트 + 물류센터(FBH) 통합, 가용재고 기준(품질대기 재고 제외)',
  수량단위: '자재 기본단위(대부분 EA). BOX 환산값은 제공하지 않음',
  금액기준: '원가팀 기말재고 단가(ending_inventory) 적용. 단가가 없는 품목의 금액은 0으로 집계되므로 수량과 함께 볼 것',
  상태판정: INVENTORY_STATUS_RULE_TEXT,
};

/** 전체 재고 한 장 요약 */
export async function getInventoryOverview() {
  const rows = await loadBatchRows();

  const byStatus: Record<string, { qty: number; value: number; itemCount: Set<string> }> = {};
  let totalQty = 0;
  let totalValue = 0;
  const allCodes = new Set<string>();
  const unpricedCodes = new Set<string>();

  rows.forEach((r) => {
    totalQty += r.qty;
    totalValue += r.value;
    allCodes.add(r.code);
    if (!r.hasPrice) unpricedCodes.add(r.code);

    if (!byStatus[r.status]) byStatus[r.status] = { qty: 0, value: 0, itemCount: new Set() };
    byStatus[r.status].qty += r.qty;
    byStatus[r.status].value += r.value;
    byStatus[r.status].itemCount.add(r.code);
  });

  const statusSummary = (Object.keys(INVENTORY_STATUS_LABELS) as InventoryRiskStatus[]).map((s) => ({
    상태: INVENTORY_STATUS_LABELS[s],
    status: s,
    수량: round(byStatus[s]?.qty || 0),
    금액: round(byStatus[s]?.value || 0),
    품목수: byStatus[s]?.itemCount.size || 0,
  }));

  const riskValue = (byStatus.disposed?.value || 0) + (byStatus.imminent?.value || 0);

  return {
    요약: {
      총재고수량: round(totalQty),
      총재고금액: round(totalValue),
      총품목수: allCodes.size,
      '폐기+임박_금액': round(riskValue),
      '폐기+임박_금액비중(%)': totalValue > 0 ? Math.round((riskValue / totalValue) * 1000) / 10 : 0,
      단가미보유_품목수: unpricedCodes.size,
    },
    상태별: statusSummary,
    참고: BASE_NOTE,
  };
}

/**
 * 제품군/브랜드/생산라인 등 그룹 단위 재고 순위.
 * "어느 제품군에 재고가 몰려 있나", "어느 제품군에 임박·폐기가 많나"에 답한다.
 */
export async function getInventoryGroupSummary(params: {
  groupBy?: GroupDimension;
  sortBy?: 'value' | 'quantity' | 'riskValue' | 'riskQuantity';
  limit?: number;
}) {
  const groupBy = params.groupBy || 'family';
  const sortBy = params.sortBy || 'value';
  const limit = clamp(Number(params.limit) || 10, 1, 30);

  const rows = await loadBatchRows();

  interface Bucket {
    qty: number;
    value: number;
    disposedQty: number;
    disposedValue: number;
    imminentQty: number;
    imminentValue: number;
    criticalQty: number;
    codes: Set<string>;
    riskCodes: Set<string>;
  }

  const map = new Map<string, Bucket>();
  let grandValue = 0;
  let grandQty = 0;

  rows.forEach((r) => {
    const key = r[groupBy] || '미지정';
    if (!map.has(key)) {
      map.set(key, {
        qty: 0, value: 0,
        disposedQty: 0, disposedValue: 0,
        imminentQty: 0, imminentValue: 0,
        criticalQty: 0,
        codes: new Set(), riskCodes: new Set(),
      });
    }
    const b = map.get(key)!;
    b.qty += r.qty;
    b.value += r.value;
    b.codes.add(r.code);
    grandQty += r.qty;
    grandValue += r.value;

    if (r.status === 'disposed') {
      b.disposedQty += r.qty; b.disposedValue += r.value; b.riskCodes.add(r.code);
    } else if (r.status === 'imminent') {
      b.imminentQty += r.qty; b.imminentValue += r.value; b.riskCodes.add(r.code);
    } else if (r.status === 'critical') {
      b.criticalQty += r.qty;
    }
  });

  const list = Array.from(map.entries()).map(([group, b]) => {
    const riskValue = b.disposedValue + b.imminentValue;
    const riskQty = b.disposedQty + b.imminentQty;
    return {
      그룹: group,
      재고수량: round(b.qty),
      재고금액: round(b.value),
      품목수: b.codes.size,
      폐기수량: round(b.disposedQty),
      폐기금액: round(b.disposedValue),
      임박수량: round(b.imminentQty),
      임박금액: round(b.imminentValue),
      긴급수량: round(b.criticalQty),
      '폐기+임박_금액': round(riskValue),
      '폐기+임박_수량비중(%)': b.qty > 0 ? Math.round((riskQty / b.qty) * 1000) / 10 : 0,
      위험품목수: b.riskCodes.size,
      _sortValue: b.value,
      _sortQty: b.qty,
      _sortRiskValue: riskValue,
      _sortRiskQty: riskQty,
    };
  });

  const sortKey =
    sortBy === 'quantity' ? '_sortQty' :
    sortBy === 'riskValue' ? '_sortRiskValue' :
    sortBy === 'riskQuantity' ? '_sortRiskQty' : '_sortValue';

  list.sort((a, b) => (b as any)[sortKey] - (a as any)[sortKey]);

  const top = list.slice(0, limit).map((r) => {
    const { _sortValue, _sortQty, _sortRiskValue, _sortRiskQty, ...rest } = r;
    return rest;
  });

  return {
    집계기준: GROUP_DIMENSION_LABELS[groupBy],
    정렬기준: sortBy,
    전체그룹수: list.length,
    표시그룹수: top.length,
    전체합계: { 재고수량: round(grandQty), 재고금액: round(grandValue) },
    그룹순위: top,
    참고: BASE_NOTE,
  };
}

/**
 * 임박·폐기 품목 리스트.
 * 품목(자재코드) 단위로 묶고, 가장 급한 것(잔여일수 짧은 순 또는 금액 큰 순)부터 반환한다.
 */
export async function getInventoryRiskItems(params: {
  bucket?: 'disposed' | 'imminent' | 'critical' | 'disposed_imminent';
  groupBy?: GroupDimension;
  groupValue?: string;
  sortBy?: 'value' | 'quantity' | 'remainDays';
  limit?: number;
}) {
  const bucket = params.bucket || 'disposed_imminent';
  const sortBy = params.sortBy || 'value';
  const limit = clamp(Number(params.limit) || 20, 1, 50);

  const targetStatuses: InventoryRiskStatus[] =
    bucket === 'disposed' ? ['disposed'] :
    bucket === 'imminent' ? ['imminent'] :
    bucket === 'critical' ? ['critical'] :
    ['disposed', 'imminent'];

  let rows = (await loadBatchRows()).filter((r) => targetStatuses.includes(r.status));

  if (params.groupBy && params.groupValue) {
    const needle = params.groupValue.trim().toLowerCase();
    rows = rows.filter((r) => String(r[params.groupBy!] || '').toLowerCase().includes(needle));
  }

  interface ItemBucket {
    code: string;
    name: string;
    brand: string;
    category: string;
    family: string;
    productionLine: string;
    stockType: string;
    qty: number;
    value: number;
    hasPrice: boolean;
    minRemainDays: number;
    nearestExpiry: string | null;
    statuses: Set<InventoryRiskStatus>;
    locations: Map<string, number>;
  }

  const map = new Map<string, ItemBucket>();

  rows.forEach((r) => {
    if (!map.has(r.code)) {
      map.set(r.code, {
        code: r.code, name: r.name,
        brand: r.brand, category: r.category, family: r.family,
        productionLine: r.productionLine, stockType: r.stockType,
        qty: 0, value: 0, hasPrice: false,
        minRemainDays: Number.POSITIVE_INFINITY,
        nearestExpiry: null,
        statuses: new Set(), locations: new Map(),
      });
    }
    const it = map.get(r.code)!;
    it.qty += r.qty;
    it.value += r.value;
    it.hasPrice = it.hasPrice || r.hasPrice;
    it.statuses.add(r.status);
    it.locations.set(r.location, (it.locations.get(r.location) || 0) + r.qty);

    if (r.remainDays !== null && r.remainDays < it.minRemainDays) {
      it.minRemainDays = r.remainDays;
      it.nearestExpiry = r.expirationDate;
    }
  });

  const list = Array.from(map.values());

  list.sort((a, b) => {
    if (sortBy === 'quantity') return b.qty - a.qty;
    if (sortBy === 'remainDays') return a.minRemainDays - b.minRemainDays;
    return b.value - a.value;
  });

  const totalQty = list.reduce((s, r) => s + r.qty, 0);
  const totalValue = list.reduce((s, r) => s + r.value, 0);

  const items = list.slice(0, limit).map((it) => ({
    자재코드: it.code,
    품목명: it.name,
    브랜드: it.brand,
    카테고리: it.category,
    제품군: it.family,
    생산라인: it.productionLine,
    재고구분: it.stockType,
    상태: Array.from(it.statuses).map((s) => INVENTORY_STATUS_LABELS[s]).join('+'),
    수량: round(it.qty),
    금액: it.hasPrice ? round(it.value) : null,
    최단잔여일수: Number.isFinite(it.minRemainDays) ? it.minRemainDays : null,
    가장빠른유통기한: it.nearestExpiry,
    주요보관처: Array.from(it.locations.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([loc, q]) => `${loc}(${round(q)})`)
      .join(', '),
  }));

  return {
    조회대상: bucket,
    필터: params.groupBy && params.groupValue
      ? `${GROUP_DIMENSION_LABELS[params.groupBy]} = ${params.groupValue}`
      : '없음(전체)',
    정렬기준: sortBy,
    해당품목수: list.length,
    표시품목수: items.length,
    합계: { 수량: round(totalQty), 금액: round(totalValue) },
    품목: items,
    참고: {
      ...BASE_NOTE,
      안내: list.length > items.length
        ? `조건에 맞는 품목 ${list.length}건 중 상위 ${items.length}건만 표시했다. 더 필요하면 limit 을 올리거나 groupBy/groupValue 로 좁혀서 다시 물어볼 것.`
        : '조건에 맞는 전체 품목을 표시했다.',
    },
  };
}
