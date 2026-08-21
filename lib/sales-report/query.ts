// lib/sales-report/query.ts
// 매출 리포트의 SQL 생성과 원시행 → 도메인 변환. **I/O 가 없는 순수 함수만** 둔다.
// 실행·캐시는 actions/sales-report-actions.ts 에 있다.

import { format, subDays, subYears } from 'date-fns';

/** 청구매출 원장. 대시보드의 납품매출(SD_ZASSDDV0020)과 **기준이 다르므로 섞어 비교하지 말 것.** */
const SALES_TABLE = '`harimfood-361004.harim_sap_bi.SD_SO`';

/** 유통채널 — SAP VTWEG. 10=내수 20=수출 */
export type SalesVtweg = 'ALL' | '10' | '20';

/** 구성비 차트가 쪼갤 수 있는 축. 값은 SD_SO 의 텍스트 컬럼과 1:1 이다. */
export type SalesDimension = 'channel' | 'brand' | 'matkl' | 'vkgrp';

export const SALES_DIMENSION_LABELS: Record<SalesDimension, string> = {
  channel: '판매채널',
  brand: '브랜드',
  matkl: '제품군',
  vkgrp: '영업그룹',
};

export interface SalesReportParams {
  /** yyyy-MM-dd */
  from: string;
  /** yyyy-MM-dd */
  to: string;
  vtweg: SalesVtweg;
  /** 고객그룹1 내역(BEZEI_KVGR1_MASTER). 빈 문자열이면 전체 */
  channel: string;
}

/** 화면·액션이 같은 값을 쓰도록 기본 기간을 한 곳에서만 만든다. */
export const SALES_REPORT_DEFAULT_MONTHS = 12;

// ─────────────────────────────────────────────────────────────
// 기간 프리셋
// ─────────────────────────────────────────────────────────────

export type SalesPresetKey = 'm3' | 'm6' | 'm12' | 'thisYear' | 'lastYear';

export const SALES_PRESET_LABELS: Record<SalesPresetKey, string> = {
  m3: '최근 3개월',
  m6: '최근 6개월',
  m12: '최근 12개월',
  thisYear: '올해',
  lastYear: '작년',
};

/**
 * 프리셋 → 실제 날짜 범위.
 *
 * `today` 를 인자로 받는 이유는 순수 함수로 두어 검증 스크립트가 고정 날짜로 대조할 수 있게 하기 위함이다.
 */
export function resolvePreset(key: SalesPresetKey, today: Date): { from: string; to: string } {
  const iso = (d: Date) => format(d, 'yyyy-MM-dd');
  const year = today.getFullYear();

  switch (key) {
    case 'm3':
      return { from: iso(subDays(today, 90)), to: iso(today) };
    case 'm6':
      return { from: iso(subDays(today, 182)), to: iso(today) };
    case 'm12':
      return { from: iso(subDays(today, 364)), to: iso(today) };
    case 'thisYear':
      return { from: `${year}-01-01`, to: iso(today) };
    case 'lastYear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}

// ─────────────────────────────────────────────────────────────
// 날짜 변환 · 방어
// ─────────────────────────────────────────────────────────────

/** SAP FKDAT 는 'yyyyMMdd' 문자열이다. 화면은 'yyyy-MM-dd' 를 쓰므로 경계에서 한 번만 바꾼다. */
export function toSapDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/** 'yyyyMMdd' → 'yyyy-MM-dd'. 형식이 아니면 원문을 그대로 돌려준다(화면이 깨지지 않게). */
export function fromSapDate(sap: string): string {
  return /^\d{8}$/.test(sap) ? `${sap.slice(0, 4)}-${sap.slice(4, 6)}-${sap.slice(6, 8)}` : sap;
}

/** 잘못된 입력이 SQL 로 흘러가지 않게 한 곳에서 막는다(파라미터 바인딩과 별개인 2차 방어). */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * 전년 동기 — 시작·종료를 각각 1년 뒤로 민다.
 *
 * ⚠️ 기간이 1년을 넘으면 전년 구간이 당기 구간과 겹친다. 그래서 SQL 에서 두 구간을
 * **각각 따로 집계**하고(겹침 허용), 행에 기간 꼬리표를 붙이지 않는다.
 */
export function previousYearRange(from: string, to: string): { from: string; to: string } {
  return {
    from: format(subYears(new Date(`${from}T00:00:00`), 1), 'yyyy-MM-dd'),
    to: format(subYears(new Date(`${to}T00:00:00`), 1), 'yyyy-MM-dd'),
  };
}

// ─────────────────────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────────────────────

/** UNION ALL 로 한 번에 받아오는 집계 묶음의 종류 */
export type SalesRowKind =
  | 'TOTAL_CUR'
  | 'TOTAL_PREV'
  | 'MONTH_CUR'
  | 'MONTH_PREV'
  | 'CHANNEL'
  | 'BRAND'
  | 'MATKL'
  | 'VKGRP'
  | 'CUSTOMER'
  | 'PRODUCT';

/** BigQuery 가 돌려주는 원시 행. 모든 kind 가 같은 스키마를 공유한다. */
export interface SalesRawRow {
  kind: SalesRowKind;
  k1: string | null;
  k2: string | null;
  k3: string | null;
  k4: string | null;
  net: number | null;
  gross: number | null;
  ded: number | null;
  qty: number | null;
  docs: number | null;
  custs: number | null;
  items: number | null;
}

/**
 * 표에 실어 보내는 제품 수 상한.
 *
 * 실측: 1년 조회에 자재 2,289종 / 직렬화 290KB(1,500행 기준). 3,000행이라도 600KB 정도라
 * 캐시 항목 2MB 제한에 한참 못 미친다. 검색이 전 품목에 닿게 하려고 실제 종수보다 넉넉히 잡았다.
 * 더 올릴 거면 `npm run verify:sales` 의 크기 체크를 먼저 확인할 것.
 */
export const PRODUCT_ROW_LIMIT = 3000;
/** 거래처 차트에 쓸 상위 건수 */
export const CUSTOMER_ROW_LIMIT = 20;

/**
 * 리포트 전체를 **한 번의 스캔**으로 받아오는 쿼리.
 *
 * SD_SO 는 2.5GB · 76컬럼이라 집계 축마다 쿼리를 나누면 그만큼 스캔 비용이 붙는다.
 * 그래서 필요한 컬럼만 담은 `base` CTE 를 만들고 그 위에서만 집계한 뒤 UNION ALL 로 한 번에 돌려준다.
 *
 * 값은 전부 **파라미터 바인딩**이다. 화면 필터가 문자열로 들어오므로 문자열 결합을 쓰지 않는다.
 */
export function buildSalesReportQuery(): string {
  // 쓰지 않는 키 자리를 메우는 빈 값.
  // ⚠️ 맨 NULL 은 BigQuery 가 INT64 로 추론해서 STRING 키를 쓰는 다른 kind 와 UNION ALL 이 안 된다.
  //    반드시 타입을 박아 둘 것.
  const NULL_STR = 'CAST(NULL AS STRING)';

  // 축 하나를 집계하는 SELECT 를 찍어내는 틀. 모든 kind 의 컬럼 수·순서·타입이 같아야 UNION ALL 이 된다.
  const agg = (kind: SalesRowKind, k1: string, k2: string, k3: string, k4: string, source = 'cur') => `
    SELECT
      '${kind}' AS kind,
      ${k1} AS k1, ${k2} AS k2, ${k3} AS k3, ${k4} AS k4,
      SUM(NETWR) AS net,
      SUM(IF(NETWR > 0, NETWR, 0)) AS gross,
      SUM(IF(NETWR < 0, -NETWR, 0)) AS ded,
      SUM(FKLMG) AS qty,
      COUNT(DISTINCT VBELN) AS docs,
      COUNT(DISTINCT KUNAG) AS custs,
      COUNT(DISTINCT MATNR) AS items
    FROM ${source}
  `;

  return `
    WITH base AS (
      SELECT
        FKDAT, NETWR, FKLMG, VBELN, KUNAG, MATNR,
        IFNULL(NULLIF(TRIM(MATNR_T), ''), MATNR) AS matnr_t,
        IFNULL(NULLIF(TRIM(NAME1_KUNAG), ''), '(미지정)') AS cust_nm,
        IFNULL(NULLIF(TRIM(BEZEI_KVGR1_MASTER), ''), '(미분류)') AS channel_nm,
        IFNULL(NULLIF(TRIM(VTEXT_PRDHA_1LV), ''), '(미분류)') AS brand_nm,
        IFNULL(NULLIF(TRIM(KTEXT_MATKL_MASTER), ''), '(미분류)') AS matkl_nm,
        IFNULL(NULLIF(TRIM(VKGRP_T), ''), '(미분류)') AS vkgrp_nm
      FROM ${SALES_TABLE}
      -- 전년 구간이 당기 구간보다 항상 앞서므로 이 범위 하나가 두 구간을 모두 덮는다.
      WHERE FKDAT BETWEEN @prevFrom AND @curTo
        AND (@vtweg = 'ALL' OR VTWEG = @vtweg)
        AND (@channel = '' OR IFNULL(NULLIF(TRIM(BEZEI_KVGR1_MASTER), ''), '(미분류)') = @channel)
    ),
    cur AS (SELECT * FROM base WHERE FKDAT BETWEEN @curFrom AND @curTo),
    prv AS (SELECT * FROM base WHERE FKDAT BETWEEN @prevFrom AND @prevTo),

    total_cur AS (${agg('TOTAL_CUR', NULL_STR, NULL_STR, NULL_STR, NULL_STR, 'cur')}),
    total_prev AS (${agg('TOTAL_PREV', NULL_STR, NULL_STR, NULL_STR, NULL_STR, 'prv')}),

    -- 월 추이는 당기·전년을 **각자의 구간 안에서** 집계한다.
    -- ⚠️ 넓은 base 에서 한 번에 월별로 묶으면 구간 양끝의 달이 통째로 딸려 들어온다.
    --    (8/22~ 로 조회해도 8월 막대가 8/1~8/31 전체가 되어 실제보다 훨씬 커 보였다.)
    --    이렇게 나눠 두면 부분월끼리 비교된다 — 8/22~8/31 vs 전년 8/22~8/31.
    months_cur AS (
      ${agg('MONTH_CUR', 'SUBSTR(FKDAT, 1, 6)', NULL_STR, NULL_STR, NULL_STR, 'cur')}
      GROUP BY k1
    ),
    months_prev AS (
      ${agg('MONTH_PREV', 'SUBSTR(FKDAT, 1, 6)', NULL_STR, NULL_STR, NULL_STR, 'prv')}
      GROUP BY k1
    ),

    channels AS (${agg('CHANNEL', 'channel_nm', NULL_STR, NULL_STR, NULL_STR)} GROUP BY k1),
    brands   AS (${agg('BRAND', 'brand_nm', NULL_STR, NULL_STR, NULL_STR)} GROUP BY k1),
    matkls   AS (${agg('MATKL', 'matkl_nm', NULL_STR, NULL_STR, NULL_STR)} GROUP BY k1),
    vkgrps   AS (${agg('VKGRP', 'vkgrp_nm', NULL_STR, NULL_STR, NULL_STR)} GROUP BY k1),

    customers AS (
      ${agg('CUSTOMER', 'KUNAG', 'cust_nm', NULL_STR, NULL_STR)}
      GROUP BY k1, k2
      ORDER BY net DESC
      LIMIT ${CUSTOMER_ROW_LIMIT}
    ),

    -- ⚠️ 제품은 **자재코드로만 묶는다.**
    -- 한 MATNR 에 이름이 여러 개 달려 있다(개명·「[미사용]」 별칭·공백 차이).
    -- 실측(2026-01-01~08-21): 자재 2,289종인데 코드+이름+제품군+브랜드 조합은 3,310개다.
    -- 이름까지 GROUP BY 에 넣으면 한 제품이 여러 줄로 쪼개져 매출이 분산되고 구성비도 조각난다.
    -- 대표 이름은 **가장 큰 전표의 이름**을 쓴다 — 실제로 팔리는 이름이 뽑히고 결과도 항상 같다.
    products AS (
      SELECT
        'PRODUCT' AS kind,
        MATNR AS k1,
        ANY_VALUE(matnr_t HAVING MAX NETWR) AS k2,
        ANY_VALUE(matkl_nm HAVING MAX NETWR) AS k3,
        ANY_VALUE(brand_nm HAVING MAX NETWR) AS k4,
        SUM(NETWR) AS net,
        SUM(IF(NETWR > 0, NETWR, 0)) AS gross,
        SUM(IF(NETWR < 0, -NETWR, 0)) AS ded,
        SUM(FKLMG) AS qty,
        COUNT(DISTINCT VBELN) AS docs,
        COUNT(DISTINCT KUNAG) AS custs,
        COUNT(DISTINCT MATNR) AS items
      FROM cur
      GROUP BY k1
      ORDER BY net DESC
      LIMIT ${PRODUCT_ROW_LIMIT}
    )

    SELECT * FROM total_cur
    UNION ALL SELECT * FROM total_prev
    UNION ALL SELECT * FROM months_cur
    UNION ALL SELECT * FROM months_prev
    UNION ALL SELECT * FROM channels
    UNION ALL SELECT * FROM brands
    UNION ALL SELECT * FROM matkls
    UNION ALL SELECT * FROM vkgrps
    UNION ALL SELECT * FROM customers
    UNION ALL SELECT * FROM products
  `;
}

/** 쿼리에 넣을 파라미터. 날짜는 여기서 한 번만 SAP 형식으로 바꾼다. */
export function buildSalesReportParams(params: SalesReportParams) {
  const prev = previousYearRange(params.from, params.to);
  return {
    curFrom: toSapDate(params.from),
    curTo: toSapDate(params.to),
    prevFrom: toSapDate(prev.from),
    prevTo: toSapDate(prev.to),
    vtweg: params.vtweg,
    channel: params.channel,
  };
}
