// lib/sales-report/board.ts
// 매출 리포트의 집계·판정 엔진. **I/O 가 없는 순수 함수만** 둔다 — 화면은 표시만 한다.

import { PRODUCT_ROW_LIMIT, type SalesDimension, type SalesRawRow, type SalesReportParams } from './query';

export interface SalesKpi {
  /**
   * 차감후 매출액 = 총매출액 − 차감. SD_SO 의 NETWR 합 그대로다.
   *
   * ⚠️ **이것을 「순매출」이라 부르지 말 것.** 사내에서 순매출은 프로모션비·행사비까지
   * 뺀 값을 가리켜서 이 값과 다르다. 여기서 빠지는 것은 반품·매출조정·매출이관뿐이다.
   */
  net: number;
  /** 총매출액 — NETWR 이 양수인 행만 */
  gross: number;
  /** 반품·매출조정 차감 — NETWR 이 음수인 행의 절대값 */
  deduction: number;
  /** 차감이 총매출액에서 차지하는 비율(%) */
  deductionRate: number;
  /** 판매수량(기본단위). 실측상 99.99%가 EA 라 사실상 EA 합계다. */
  qty: number;
  /** 청구문서 건수 */
  docs: number;
  /** 거래한 판매처 수 */
  customers: number;
  /** 팔린 자재 수 */
  items: number;
  /** 기간 일수로 나눈 일평균 차감후 매출액 */
  dailyAvg: number;
  /** 전년 동기 차감후 매출액 */
  prevNet: number;
  /** 전년 대비 증감률(%). 전년이 0 이면 null — 0 으로 나눈 값을 만들지 않는다. */
  yoyRate: number | null;
}

export interface SalesMonthPoint {
  /** yyyyMM */
  ym: string;
  /** 'YY.M' 형태의 축 라벨 */
  label: string;
  net: number;
  /** 12개월 전 같은 달의 차감후 매출액. 자료가 없으면 null(0 과 구분한다) */
  prevNet: number | null;
  qty: number;
}

export interface SalesRankRow {
  key: string;
  net: number;
  /** 해당 축 합계에서 차지하는 비율(%) */
  share: number;
  qty: number;
  docs: number;
}

export interface SalesCustomerRow {
  code: string;
  name: string;
  net: number;
  share: number;
  docs: number;
}

export interface SalesProductRow {
  matnr: string;
  name: string;
  matkl: string;
  brand: string;
  net: number;
  qty: number;
  docs: number;
  share: number;
}

export interface SalesReportBoard {
  kpi: SalesKpi;
  monthly: SalesMonthPoint[];
  ranks: Record<SalesDimension, SalesRankRow[]>;
  customers: SalesCustomerRow[];
  products: SalesProductRow[];
  /** 제품 표가 상한에서 잘렸는지 — 잘렸다면 화면에서 숨기지 않고 알린다. */
  productsTruncated: boolean;
}

const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** yyyyMM 을 12개월 뒤로 민다. 문자열 산술이라 타임존 영향이 없다. */
export function shiftYmYear(ym: string, years: number): string {
  const y = Number(ym.slice(0, 4));
  return `${y + years}${ym.slice(4, 6)}`;
}

/** 'YY.M' — 12개월치를 좁은 축에 얹어야 해서 연도는 두 자리만 쓴다. */
export function ymLabel(ym: string): string {
  return `${ym.slice(2, 4)}.${Number(ym.slice(4, 6))}`;
}

/** 기간에 포함된 일수(양끝 포함). 일평균의 분모다. */
export function daySpan(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** 분모가 0 이면 비율을 만들지 않는다 — 화면에서 '—' 로 표시하기 위해 null 을 그대로 올린다. */
function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/**
 * 원시행 묶음 → 화면이 쓰는 형태.
 *
 * 축별 구성비의 분모는 **그 축의 양수 매출 합**이다. 차감후 매출액으로 나누면 차감이 큰 축에서
 * 100%를 넘는 조각이 생겨 막대 길이가 뒤집힌다(반품이 매출보다 큰 거래처가 실제로 있다).
 */
export function buildSalesBoard(rows: SalesRawRow[], params: SalesReportParams): SalesReportBoard {
  const of = (kind: string) => rows.filter((r) => r.kind === kind);

  const totalCur = of('TOTAL_CUR')[0];
  const totalPrev = of('TOTAL_PREV')[0];

  const net = num(totalCur?.net);
  const gross = num(totalCur?.gross);
  const deduction = num(totalCur?.ded);
  const prevNet = num(totalPrev?.net);
  const days = daySpan(params.from, params.to);

  const kpi: SalesKpi = {
    net,
    gross,
    deduction,
    deductionRate: share(deduction, gross),
    qty: num(totalCur?.qty),
    docs: num(totalCur?.docs),
    customers: num(totalCur?.custs),
    items: num(totalCur?.items),
    dailyAvg: net / days,
    prevNet,
    yoyRate: rate(net - prevNet, Math.abs(prevNet)),
  };

  // ── 월 추이 ─────────────────────────────────────────────
  // 당기·전년이 **각자의 구간 안에서** 집계돼 따로 온다. 그래서 구간 양끝의 부분월이
  // 통째로 부풀지 않고, 부분월은 전년의 같은 부분월과 비교된다(8/22~8/31 vs 전년 8/22~8/31).
  const curMonths = new Map<string, { net: number; qty: number }>();
  for (const r of of('MONTH_CUR')) {
    if (!r.k1) continue;
    curMonths.set(r.k1, { net: num(r.net), qty: num(r.qty) });
  }

  const prevMonths = new Map<string, number>();
  for (const r of of('MONTH_PREV')) {
    if (!r.k1) continue;
    prevMonths.set(r.k1, num(r.net));
  }

  const monthly: SalesMonthPoint[] = [...curMonths.keys()]
    .sort()
    .map((ym) => {
      const prevKey = shiftYmYear(ym, -1);
      return {
        ym,
        label: ymLabel(ym),
        net: curMonths.get(ym)?.net ?? 0,
        // 자료가 없는 달은 0 이 아니라 null 이다 — 화면에서 '—' 로 구분해 보여준다.
        prevNet: prevMonths.has(prevKey) ? (prevMonths.get(prevKey) as number) : null,
        qty: curMonths.get(ym)?.qty ?? 0,
      };
    });

  // ── 축별 랭킹 ───────────────────────────────────────────
  const toRanks = (kind: string): SalesRankRow[] => {
    const list = of(kind);
    const whole = list.reduce((sum, r) => sum + Math.max(num(r.net), 0), 0);
    return list
      .map((r) => ({
        key: r.k1 ?? '(미분류)',
        net: num(r.net),
        share: share(Math.max(num(r.net), 0), whole),
        qty: num(r.qty),
        docs: num(r.docs),
      }))
      .sort((a, b) => b.net - a.net);
  };

  const ranks: Record<SalesDimension, SalesRankRow[]> = {
    channel: toRanks('CHANNEL'),
    brand: toRanks('BRAND'),
    matkl: toRanks('MATKL'),
    vkgrp: toRanks('VKGRP'),
  };

  // ── 거래처 · 제품 ───────────────────────────────────────
  const customers: SalesCustomerRow[] = of('CUSTOMER')
    .map((r) => ({
      code: r.k1 ?? '',
      name: r.k2 ?? '(미지정)',
      net: num(r.net),
      share: share(Math.max(num(r.net), 0), Math.max(net, 0)),
      docs: num(r.docs),
    }))
    .sort((a, b) => b.net - a.net);

  const productRows = of('PRODUCT');
  const products: SalesProductRow[] = productRows
    .map((r) => ({
      matnr: r.k1 ?? '',
      name: r.k2 ?? '',
      matkl: r.k3 ?? '(미분류)',
      brand: r.k4 ?? '(미분류)',
      net: num(r.net),
      qty: num(r.qty),
      docs: num(r.docs),
      share: share(Math.max(num(r.net), 0), Math.max(net, 0)),
    }))
    .sort((a, b) => b.net - a.net);

  // 상한에 정확히 닿았으면 잘렸다고 본다. 표 아래에 그대로 알린다 — 합계와 표가 안 맞는 이유가 이것뿐이라야 한다.
  return {
    kpi,
    monthly,
    ranks,
    customers,
    products,
    productsTruncated: productRows.length >= PRODUCT_ROW_LIMIT,
  };
}

// ─────────────────────────────────────────────────────────────
// 표시 헬퍼 — 화면 여러 곳에서 같은 반올림을 쓰도록 여기 모은다
// ─────────────────────────────────────────────────────────────

/** 억 단위. 이 리포트의 금액은 조 단위가 아니라 억이 읽기 좋다. */
export function toEok(won: number): number {
  return won / 100_000_000;
}

export function formatEok(won: number, digits = 1): string {
  return `${toEok(won).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}억`;
}

export function formatWon(won: number): string {
  return `${Math.round(won).toLocaleString('ko-KR')}원`;
}

export function formatQty(qty: number): string {
  return Math.round(qty).toLocaleString('ko-KR');
}

export function formatRate(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/**
 * 이 리포트가 무엇을 세는지 화면에 그대로 노출한다.
 *
 * 이 앱의 오해는 대부분 "어떤 매출인가"에서 나온다. 대시보드는 납품매출이고 여기는 청구매출이라
 * 숫자가 다른 것이 정상인데, 근거를 숨기면 사용자가 둘을 같은 값으로 기대하게 된다.
 */
export const SALES_BASIS_TEXT = [
  '기준: SAP 청구매출(SD_SO)의 빌링일자(FKDAT). 「종합 현황」의 납품매출(납품요청일 VDATU)과는 기준이 달라 숫자가 다른 것이 정상이다.',
  '차감후 매출액 = 총매출액 − 차감. 반품·매출조정 전표가 음수 금액으로 들어 있어 합계가 곧 이 값이다.',
  '⚠️ 이 값은 사내에서 말하는 「순매출」이 아니다. 여기서 빠진 것은 반품·매출조정·매출이관뿐이고, 프로모션비·행사비는 차감되지 않았다.',
  '판매수량은 기본단위(FKLMG) 합이다. 무상오더는 수량만 있고 금액이 0 이라 수량으로 나눈 단가는 실제 판매단가보다 낮게 나온다.',
  '유통채널 10=내수, 20=수출.',
].join('\n');
