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
 * 이 테이블에 단가가 없는 자재는 "직전 마감월에 재고가 없던 자재" = 당월 첫 생산분이므로
 * 금액을 만들어내지 않고 `CURRENT_MONTH`(당월생산)로 표기한다.
 */
import { unstable_cache } from 'next/cache';

/** 단가를 어디서 얻었는지. UI 표기가 이 값에 따라 갈린다. */
export type PriceSource =
  | 'ENDING_INVENTORY' // 기말재고 단가 적용 → 금액 표시
  | 'CURRENT_MONTH' // 직전 마감월에 없던 자재 = 당월생산 → 금액 없음
  | 'UNKNOWN'; // 단가 소스 자체를 못 읽음 → 금액 판단 불가

export interface EndingInventoryPrices {
  /** 조회에 성공했는지. 실패 시 모든 자재를 UNKNOWN 으로 떨어뜨린다. */
  available: boolean;
  /** 사용한 스냅샷 (예: '202607') */
  asOfMonth: string;
  /** 사람이 읽는 기준월 (예: '2026년 6월 기말') */
  asOfLabel: string;
  /** `${material_code}|${plant}` → 단가. 플랜트별로 단가가 다르므로 이쪽이 우선이다. */
  byPlant: Record<string, number>;
  /** `material_code` → 단가. 플랜트가 안 맞을 때의 폴백. */
  byCode: Record<string, number>;
}

const EMPTY: EndingInventoryPrices = {
  available: false,
  asOfMonth: '',
  asOfLabel: '',
  byPlant: {},
  byCode: {},
};

/** 완제품·상품 자재 대역. 코드가 모두 8자리라 문자열 비교로 충분하다. */
const MATNR_FROM = '50000000';
const MATNR_TO = '69999999';
const PAGE_SIZE = 1000;

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

    const byPlant: Record<string, number> = {};
    const byCode: Record<string, number> = {};

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

        if (plant) byPlant[`${code}|${plant}`] = price;
        // 플랜트 폴백은 아무 값이나 잡는 대신 가장 비싼 쪽을 피하려고 첫 값을 유지한다.
        if (byCode[code] === undefined) byCode[code] = price;
      });

      if (rows.length < PAGE_SIZE) break;
    }

    return {
      available: true,
      asOfMonth,
      asOfLabel: toLabel(asOfMonth),
      byPlant,
      byCode,
    };
  } catch (error) {
    console.error('🚨 기말재고 단가 조회 실패:', error);
    return EMPTY;
  }
}

/** 월 1회만 갱신되는 데이터라 1시간 캐시로 충분하다. */
export const getEndingInventoryPrices = unstable_cache(
  fetchEndingInventoryPrices,
  ['ending-inventory-prices-v1'],
  { revalidate: 3600, tags: ['ending-inventory-price'] }
);

/** 자재+플랜트 → 단가. 못 찾으면 null 을 돌려주고 호출부가 당월생산으로 처리한다. */
export function resolveUnitPrice(
  prices: EndingInventoryPrices,
  matnr: string,
  werks?: string | null
): { unitPrice: number; source: PriceSource } {
  if (!prices.available) return { unitPrice: 0, source: 'UNKNOWN' };

  const code = String(matnr || '').trim();
  const plant = String(werks || '').trim();

  const exact = plant ? prices.byPlant[`${code}|${plant}`] : undefined;
  if (exact && exact > 0) return { unitPrice: exact, source: 'ENDING_INVENTORY' };

  const fallback = prices.byCode[code];
  if (fallback && fallback > 0) return { unitPrice: fallback, source: 'ENDING_INVENTORY' };

  return { unitPrice: 0, source: 'CURRENT_MONTH' };
}
