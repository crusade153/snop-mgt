/**
 * 기말재고 단가 조회 (Supabase `public.ending_inventory`)
 *
 * 원가팀이 매월 마감 후 올리는 기초재고 스냅샷이며, `as_of_month`(YYYYMM)는 "그 달의 기초"
 * 즉 전월 기말을 뜻한다. 예) as_of_month=202607 → 2026년 6월 기말 단가.
 *
 * SAP 자재마스터(MM_ZMMR1140)의 표준가(STPRS)는 미사용 자재·벌크 자재에 5천만원/EA 같은
 * 값이 남아 있어 재고금액이 실제의 30배 이상으로 튀었다. 그래서 단가 소스를 원가팀 확정치인
 * 이 테이블로 일원화한다.
 *
 * 최신 마감월에 단가가 없는 자재는 **과거월로 최대 6개월까지 거슬러 찾는다**.
 * 그래도 못 찾으면 금액을 만들어내지 않고 `CURRENT_MONTH`(당월생산)로 표기한다.
 * 어느 월 단가를 적용했는지는 `priceMonth` 로 따라다니므로 화면에서 "최신 단가가 아님"을 숨기지 않는다.
 */
import { unstable_cache } from 'next/cache';

/** 단가를 어디서 얻었는지. UI 표기가 이 값에 따라 갈린다. */
export type PriceSource =
  | 'ENDING_INVENTORY' // 기말재고 단가 적용 → 금액 표시 (과거월 폴백 포함, 적용월은 priceMonth 로 구분)
  | 'CURRENT_MONTH' // 6개월 역탐색으로도 못 찾음 = 당월 첫 생산분 → 금액 없음
  | 'UNKNOWN'; // 단가 소스 자체를 못 읽음 → 금액 판단 불가

/** 단가 한 건. 어느 월 스냅샷에서 왔는지를 값과 함께 들고 다닌다. */
export interface PriceEntry {
  price: number;
  /** 이 단가를 가져온 as_of_month (예: '202607') */
  month: string;
}

export interface EndingInventoryPrices {
  /** 조회에 성공했는지. 실패 시 모든 자재를 UNKNOWN 으로 떨어뜨린다. */
  available: boolean;
  /** 가장 최신 스냅샷 (예: '202607') */
  asOfMonth: string;
  /** 사람이 읽는 기준월 (예: '2026년 6월 기말') */
  asOfLabel: string;
  /** 실제로 읽어들인 월 목록. 최신 → 과거 순 */
  months: string[];
  /** `${material_code}|${plant}` → 단가. 플랜트별로 단가가 다르므로 이쪽이 우선이다. */
  byPlant: Record<string, PriceEntry>;
  /** `material_code` → 단가. 플랜트가 안 맞을 때의 폴백. */
  byCode: Record<string, PriceEntry>;
}

const EMPTY: EndingInventoryPrices = {
  available: false,
  asOfMonth: '',
  asOfLabel: '',
  months: [],
  byPlant: {},
  byCode: {},
};

/** 완제품·상품 자재 대역. 코드가 모두 8자리라 문자열 비교로 충분하다. */
const MATNR_FROM = '50000000';
const MATNR_TO = '69999999';
const PAGE_SIZE = 1000;

/**
 * 최신월에 단가가 없을 때 거슬러 올라가는 최대 개월 수.
 *
 * 이보다 오래된 단가는 현실성이 떨어져 금액을 만들지 않는 편이 낫다는 판단이다.
 * 늘리면 "금액 없음" 품목은 줄지만 오래된 단가로 평가된 금액이 늘어난다.
 */
const MAX_FALLBACK_MONTHS = 6;

/** '202607' → '202606'. 1월은 전년 12월로 넘긴다. */
function previousMonth(asOfMonth: string) {
  const year = Number(asOfMonth.slice(0, 4));
  const month = Number(asOfMonth.slice(4, 6));
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toLabel(asOfMonth: string) {
  if (!/^\d{6}$/.test(asOfMonth)) return asOfMonth;

  // as_of_month 는 "해당 월의 기초" = 전월 기말이다.
  const year = Number(asOfMonth.slice(0, 4));
  const month = Number(asOfMonth.slice(4, 6));
  const closingDate = new Date(year, month - 1, 1);
  closingDate.setMonth(closingDate.getMonth() - 1);

  return `${closingDate.getFullYear()}년 ${closingDate.getMonth() + 1}월 기말`;
}

async function requestRows(path: string) {
  const baseUrl = process.env.ENDING_INVENTORY_SUPABASE_URL;
  const anonKey = process.env.ENDING_INVENTORY_SUPABASE_ANON_KEY;

  if (!baseUrl || !anonKey) {
    throw new Error('ENDING_INVENTORY_SUPABASE_URL / ENDING_INVENTORY_SUPABASE_ANON_KEY 가 설정되지 않았습니다.');
  }

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`ending_inventory 조회 실패 (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as Record<string, unknown>[];
}

/** 한 달치 단가를 통째로 읽어 맵에 채운다. 이미 있는 키는 건드리지 않는다(최신월 우선). */
async function loadMonthInto(
  asOfMonth: string,
  byPlant: Record<string, PriceEntry>,
  byCode: Record<string, PriceEntry>
) {
  let rowCount = 0;

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await requestRows(
      'ending_inventory' +
        '?select=material_code,plant,unit_price' +
        `&as_of_month=eq.${asOfMonth}` +
        `&material_code=gte.${MATNR_FROM}&material_code=lte.${MATNR_TO}` +
        `&limit=${PAGE_SIZE}&offset=${offset}`
    );

    rows.forEach((row) => {
      const code = String(row.material_code || '').trim();
      const plant = String(row.plant || '').trim();
      const price = Number(row.unit_price || 0);
      if (!code || price <= 0) return;

      // 최신월이 먼저 들어오므로, 이미 채워진 키를 과거월이 덮어쓰지 않게 막는다.
      if (plant && byPlant[`${code}|${plant}`] === undefined) {
        byPlant[`${code}|${plant}`] = { price, month: asOfMonth };
      }
      // 플랜트 폴백은 아무 값이나 잡는 대신 가장 비싼 쪽을 피하려고 첫 값을 유지한다.
      if (byCode[code] === undefined) byCode[code] = { price, month: asOfMonth };
    });

    rowCount += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }

  return rowCount;
}

async function fetchEndingInventoryPrices(): Promise<EndingInventoryPrices> {
  try {
    const [latest] = await requestRows(
      'ending_inventory?select=as_of_month&as_of_month=not.is.null&order=as_of_month.desc&limit=1'
    );
    const asOfMonth = String(latest?.as_of_month || '');

    if (!asOfMonth) {
      console.warn('⚠️ ending_inventory 에 as_of_month 가 있는 행이 없습니다.');
      return EMPTY;
    }

    const byPlant: Record<string, PriceEntry> = {};
    const byCode: Record<string, PriceEntry> = {};
    const months: string[] = [];

    // 최신월 → 과거월 순으로 채운다. 최신월에 있는 자재는 과거월을 읽어도 값이 바뀌지 않는다.
    let cursor = asOfMonth;
    for (let step = 0; step < MAX_FALLBACK_MONTHS; step += 1) {
      const rowCount = await loadMonthInto(cursor, byPlant, byCode);
      if (rowCount > 0) months.push(cursor);
      cursor = previousMonth(cursor);
    }

    return {
      available: true,
      asOfMonth,
      asOfLabel: toLabel(asOfMonth),
      months,
      byPlant,
      byCode,
    };
  } catch (error) {
    console.error('🚨 기말재고 단가 조회 실패:', error);
    return EMPTY;
  }
}

/** 월 1회만 갱신되는 데이터라 1시간 캐시로 충분하다. */
// v2: 과거월 역탐색을 붙이면서 자료구조(byPlant/byCode 가 PriceEntry)와 금액이 바뀌어 버전을 올렸다.
export const getEndingInventoryPrices = unstable_cache(
  fetchEndingInventoryPrices,
  ['ending-inventory-prices-v2-month-fallback'],
  { revalidate: 3600, tags: ['ending-inventory-price'] }
);

/**
 * 자재+플랜트 → 단가.
 *
 * 최신월에 없으면 과거월(최대 6개월) 단가가 이미 맵에 채워져 있으므로 여기서는 조회만 한다.
 * `priceMonth` 가 `prices.asOfMonth` 와 다르면 과거월 단가가 적용된 것이다.
 */
export function resolveUnitPrice(
  prices: EndingInventoryPrices,
  matnr: string,
  werks?: string | null
): { unitPrice: number; source: PriceSource; priceMonth: string } {
  if (!prices.available) return { unitPrice: 0, source: 'UNKNOWN', priceMonth: '' };

  const code = String(matnr || '').trim();
  const plant = String(werks || '').trim();

  const exact = plant ? prices.byPlant[`${code}|${plant}`] : undefined;
  if (exact && exact.price > 0) {
    return { unitPrice: exact.price, source: 'ENDING_INVENTORY', priceMonth: exact.month };
  }

  const fallback = prices.byCode[code];
  if (fallback && fallback.price > 0) {
    return { unitPrice: fallback.price, source: 'ENDING_INVENTORY', priceMonth: fallback.month };
  }

  return { unitPrice: 0, source: 'CURRENT_MONTH', priceMonth: '' };
}
