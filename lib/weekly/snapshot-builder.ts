/**
 * 주간 재고 스냅샷 행 생성 — BigQuery 읽기 전용
 *
 * Supabase 쓰기는 `lib/weekly-snapshot.ts` 에 있다. 여기를 분리해 둔 이유는
 * `lib/admin-auth.ts` 가 `next/headers` 를 끌어와 Next 런타임 밖에서는 로드되지 않기 때문이다.
 * 이 파일만 따로 두면 `scripts/verify-weekly.mjs` 가 실데이터로 적재 행을 검증할 수 있다.
 *
 * ⚠️ 재고는 소급 생성이 불가능하다. `V_MM_MCHB_ALL` 은 "지금" 재고만 주므로
 * 지난 일요일 재고를 되돌려 만들 수 없다. 여기서 만드는 재고 열은 항상 "호출 시점의 재고"다.
 */

import { differenceInCalendarDays, parseISO } from 'date-fns';
import bigqueryClient from '@/lib/bigquery';
import { safeExtractDateStr } from '@/lib/analysis';
import { getEndingInventoryPrices, resolveUnitPrice } from '@/lib/ending-inventory-price';
import {
  categoryOfDispo,
  isFbhMirrorLocation,
  plantOfCategory,
  storageScopeOfLgort,
  type WeeklyStorageScope,
} from '@/lib/weekly/classification';
import {
  createWeeklyBuckets,
  weeklyBucketKeyOf,
  type WeeklySnapshotRow,
} from '@/lib/weekly/board';
import {
  buildDispoMasterQuery,
  buildMonthToDateSalesQuery,
  buildWeeklyFbhInventoryQuery,
  buildWeeklyPlantInventoryQuery,
  buildWeeklyProductionQuery,
  buildWeeklyShipmentQuery,
} from '@/lib/weekly/queries';
import { monthToDateRange, toCompactDate, type WeekRange } from '@/lib/weekly/week';

interface DispoRow {
  MATNR: string;
  DISPO: string;
  WERKS: string;
}

interface PlantInventoryRow {
  MATNR: string;
  MATNR_T: string;
  MEINS: string;
  LGORT: string;
  LGOBE: string;
  /** 배치 마스터에서 붙인 플랜트. 단가가 플랜트별로 달라 금액 환산의 키다 */
  WERKS: string | null;
  VFDAT: string;
  CLABS: number;
  CINSM: number;
  remain_rate: number;
  remain_day: number;
}

interface FbhInventoryRow {
  MATNR: string;
  MATNR_T: string;
  MEINS: string;
  PRDT_DATE_NEW: string;
  VALID_DATETIME_NEW: string;
  AVLB_QTY: number;
  REMAINING_DAY: number;
}

/**
 * 누적용 중간 상태. SKU × 창고그룹 하나에 대응한다.
 *
 * ⚠️ 수량이 아니라 **금액을 누적한다.** 같은 자재라도 배치가 있는 플랜트마다 단가가 다르므로
 * 「합친 수량 × 대표단가」로 계산하면 `/stock` 과 금액이 갈린다(실측 68품목·0.04억).
 */
interface Accumulator {
  materialCode: string;
  scope: WeeklyStorageScope;
  name: string;
  unit: string;
  qty: number;
  value: number;
  /** 잔여율 구간별 **금액** */
  buckets: ReturnType<typeof createWeeklyBuckets>;
}

/** SKU 대표 단가. 재고가 가장 많은 플랜트의 단가를 출고·생산 환산에 쓴다. */
interface RepresentativePrice {
  unitPrice: number;
  source: string;
  priceMonth: string;
  qty: number;
}

/** 잔여일 → 잔여율. FBH 는 remain_rate 가 없어 생산일·유통기한으로 직접 계산한다. */
function fbhRemainRate(prdtDate: string, validDate: string, remainDays: number) {
  const from = safeExtractDateStr(prdtDate);
  const to = safeExtractDateStr(validDate);
  if (from.length !== 8 || to.length !== 8) return 0;

  const shelfLife = differenceInCalendarDays(
    parseISO(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6, 8)}`),
    parseISO(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}`)
  );
  if (shelfLife <= 0) return 0;
  return (remainDays / shelfLife) * 100;
}

/**
 * 플랜트 배치의 remain_rate 는 0~1 로 들어오는 행이 섞여 있다(실측).
 * 10 이하면 비율로 보고 100 을 곱한다 — 기존 대시보드와 같은 보정이다.
 */
function normalizeRate(raw: number) {
  const rate = Number(raw || 0);
  return Math.abs(rate) <= 10 ? rate * 100 : rate;
}

function accumulatorKey(materialCode: string, scope: WeeklyStorageScope) {
  return `${materialCode}|${scope}`;
}

function touch(
  map: Map<string, Accumulator>,
  materialCode: string,
  scope: WeeklyStorageScope,
  name: string,
  unit: string
) {
  const key = accumulatorKey(materialCode, scope);
  let entry = map.get(key);
  if (!entry) {
    entry = {
      materialCode,
      scope,
      name,
      unit,
      qty: 0,
      value: 0,
      buckets: createWeeklyBuckets(),
    };
    map.set(key, entry);
  }
  return entry;
}

async function runQuery<T>(query: string): Promise<T[]> {
  const [rows] = await bigqueryClient.query({ query });
  return rows as T[];
}

/** 한 주차의 적재 행을 만든다. Supabase 는 건드리지 않는다. */
export async function buildWeeklySnapshotRows(week: WeekRange): Promise<WeeklySnapshotRow[]> {
  const from = toCompactDate(week.weekStart);
  const to = toCompactDate(week.weekEnd);
  const mtd = monthToDateRange(week.weekEnd);

  const [dispoRows, plantRows, fbhRows, shipmentRows, productionRows, mtdRows, prices] =
    await Promise.all([
      runQuery<DispoRow>(buildDispoMasterQuery()),
      runQuery<PlantInventoryRow>(buildWeeklyPlantInventoryQuery()),
      runQuery<FbhInventoryRow>(buildWeeklyFbhInventoryQuery()).catch((error) => {
        // FBH 는 외부 시스템이라 단독으로 실패할 수 있다. 나머지 재고까지 죽이지 않는다.
        console.warn('⚠️ FBH 재고 조회 실패:', error);
        return [] as FbhInventoryRow[];
      }),
      runQuery<{ MATNR: string; SHIPPED_QTY: number; SALES_AMOUNT: number }>(
        buildWeeklyShipmentQuery(from, to)
      ),
      runQuery<{ MATNR: string; PRODUCED_QTY: number }>(buildWeeklyProductionQuery(from, to)),
      runQuery<{ MATNR: string; SALES_AMOUNT: number }>(
        buildMonthToDateSalesQuery(toCompactDate(mtd.from), toCompactDate(mtd.to))
      ),
      getEndingInventoryPrices(),
    ]);

  const dispoByCode = new Map(dispoRows.map((row) => [String(row.MATNR), String(row.DISPO || '')]));
  const plantByCode = new Map(dispoRows.map((row) => [String(row.MATNR), String(row.WERKS || '')]));
  const accumulators = new Map<string, Accumulator>();
  const names = new Map<string, { name: string; unit: string }>();
  /** SKU → 재고가 가장 많은 플랜트의 단가. 출고·생산 금액은 이 대표 단가로 환산한다. */
  const representative = new Map<string, RepresentativePrice>();

  const rememberPrice = (
    code: string,
    qty: number,
    price: { unitPrice: number; source: string; priceMonth: string }
  ) => {
    const current = representative.get(code);
    if (current && current.qty >= qty) return;
    representative.set(code, { ...price, qty });
  };

  // 재고 기준일 기준의 잔여일을 다시 계산하지 않는다.
  // 스냅샷은 "지금 재고"를 찍는 것이고, 그 시점의 remain_rate 가 곧 주차 마감 상태다.
  plantRows.forEach((row) => {
    // 물류 재고와 이중계상되는 저장위치는 통째로 뺀다.
    if (isFbhMirrorLocation(row.LGORT)) return;

    // ⚠️ 품질대기(CINSM)는 더하지 않는다. `/stock` 의 「재고금액」이 가용재고(CLABS)만 세기 때문에
    // 여기서 합치면 두 화면의 재고금액이 어긋난다. 품질대기는 /stock 에서 별도 컬럼으로 본다.
    const qty = Number(row.CLABS || 0);
    if (qty <= 0) return;

    const code = String(row.MATNR);
    const scope = storageScopeOfLgort(row.LGORT);
    const entry = touch(accumulators, code, scope, row.MATNR_T || code, row.MEINS || 'EA');
    names.set(code, { name: row.MATNR_T || code, unit: row.MEINS || 'EA' });

    // 단가는 배치가 있는 플랜트 기준이다(`/stock` 과 같은 규칙). 없으면 자재코드 폴백으로 떨어진다.
    const price = resolveUnitPrice(prices, code, row.WERKS);
    const value = qty * price.unitPrice;
    rememberPrice(code, qty, price);

    entry.qty += qty;
    entry.value += value;

    // 기한없음 재고를 잔여율 구간에 넣으면 remain_rate 0 때문에 전부 '~50%' 로 오분류된다.
    const hasExpiry = safeExtractDateStr(row.VFDAT).length === 8;
    const bucketKey = hasExpiry ? weeklyBucketKeyOf(normalizeRate(row.remain_rate)) : 'over85';
    entry.buckets[bucketKey] += value;
  });

  fbhRows.forEach((row) => {
    const qty = Number(row.AVLB_QTY || 0);
    if (qty <= 0) return;

    const code = String(row.MATNR);
    const entry = touch(accumulators, code, 'LOGISTICS', row.MATNR_T || code, row.MEINS || 'EA');
    if (!names.has(code)) names.set(code, { name: row.MATNR_T || code, unit: row.MEINS || 'EA' });

    // FBH 는 플랜트 정보가 없으므로 자재코드 폴백 단가만 쓴다(`/stock` 과 같다).
    const price = resolveUnitPrice(prices, code);
    const value = qty * price.unitPrice;
    rememberPrice(code, qty, price);

    entry.qty += qty;
    entry.value += value;

    const hasExpiry = safeExtractDateStr(row.VALID_DATETIME_NEW).length === 8;
    const rate = hasExpiry
      ? fbhRemainRate(row.PRDT_DATE_NEW, row.VALID_DATETIME_NEW, Number(row.REMAINING_DAY || 0))
      : 0;
    const bucketKey = hasExpiry ? weeklyBucketKeyOf(rate) : 'over85';
    entry.buckets[bucketKey] += value;
  });

  const shipments = new Map(
    shipmentRows.map((row) => [
      String(row.MATNR),
      { qty: Number(row.SHIPPED_QTY || 0), sales: Number(row.SALES_AMOUNT || 0) },
    ])
  );
  const production = new Map(
    productionRows.map((row) => [String(row.MATNR), Number(row.PRODUCED_QTY || 0)])
  );
  const mtdSales = new Map(
    mtdRows.map((row) => [String(row.MATNR), Number(row.SALES_AMOUNT || 0)])
  );

  // 재고가 0 이어도 그 주에 출고·생산이 있었으면 행을 남겨야 흐름이 끊기지 않는다.
  // 흐름만 있는 SKU 는 플랜트 그룹에 붙인다(어느 창고에서 나갔는지는 전표가 알려주지 않는다).
  const flowOnlyCodes = new Set<string>();
  [...shipments.keys(), ...production.keys()].forEach((code) => {
    const hasStock = (['PLANT', 'LOGISTICS', 'OTHER'] as WeeklyStorageScope[]).some((scope) =>
      accumulators.has(accumulatorKey(code, scope))
    );
    if (!hasStock) flowOnlyCodes.add(code);
  });
  flowOnlyCodes.forEach((code) => {
    const info = names.get(code);
    touch(accumulators, code, 'PLANT', info?.name || code, info?.unit || 'EA');
  });

  // 출고·생산·매출은 SKU 단위 값이라 창고그룹으로 나눌 수 없다.
  // 중복 합산을 막으려고 SKU 당 한 그룹(재고가 가장 큰 그룹)에만 싣는다.
  const primaryScope = new Map<string, WeeklyStorageScope>();
  [...accumulators.values()].forEach((entry) => {
    const current = primaryScope.get(entry.materialCode);
    if (!current) {
      primaryScope.set(entry.materialCode, entry.scope);
      return;
    }
    const currentQty =
      accumulators.get(accumulatorKey(entry.materialCode, current))?.qty || 0;
    if (entry.qty > currentQty) primaryScope.set(entry.materialCode, entry.scope);
  });

  return [...accumulators.values()].map((entry) => {
    const code = entry.materialCode;
    const dispo = dispoByCode.get(code) || null;
    const category = categoryOfDispo(dispo);

    // 재고금액은 이미 배치 플랜트 단가로 쌓았다. 여기 단가는 출고·생산 환산과 표기용 대표값이다.
    // 재고가 아예 없는(흐름만 있는) SKU 는 자재마스터의 대표 플랜트로 떨어진다.
    const fallback = resolveUnitPrice(prices, code, plantByCode.get(code) || null);
    const { unitPrice, source, priceMonth } = representative.get(code) || fallback;

    const isPrimary = primaryScope.get(code) === entry.scope;
    const shipment = isPrimary ? shipments.get(code) : undefined;
    const producedQty = isPrimary ? production.get(code) || 0 : 0;
    const shippedQty = shipment?.qty || 0;

    return {
      week_end_date: week.weekEnd,
      material_code: code,
      storage_scope: entry.scope,
      product_name: entry.name,
      dispo,
      plant: plantOfCategory(category),
      category,
      unit: entry.unit,
      stock_qty: Math.round(entry.qty * 1000) / 1000,
      stock_value: Math.round(entry.value),
      bucket_under50: Math.round(entry.buckets.under50),
      bucket_50_70: Math.round(entry.buckets.r50_70),
      bucket_70_75: Math.round(entry.buckets.r70_75),
      bucket_75_85: Math.round(entry.buckets.r75_85),
      bucket_85_over: Math.round(entry.buckets.over85),
      shipped_qty: Math.round(shippedQty * 1000) / 1000,
      shipped_value: Math.round(shippedQty * unitPrice),
      produced_qty: Math.round(producedQty * 1000) / 1000,
      produced_value: Math.round(producedQty * unitPrice),
      sales_amount: Math.round(shipment?.sales || 0),
      sales_mtd: isPrimary ? Math.round(mtdSales.get(code) || 0) : 0,
      // 여러 플랜트에 걸친 자재는 재고금액이 플랜트별 단가로 쌓이므로 `stock_qty × unit_price` 와 몇 원 어긋난다.
      unit_price: unitPrice,
      price_month: priceMonth || null,
      price_source: source,
    } satisfies WeeklySnapshotRow;
  });
}

