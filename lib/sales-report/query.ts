// lib/sales-report/query.ts
// 매출 리포트의 SQL 생성과 원시행 → 도메인 변환. **I/O 가 없는 순수 함수만** 둔다.
// 실행·캐시는 actions/sales-report-actions.ts 에 있다.

import { format, subDays, subYears } from 'date-fns';

/** 청구매출 원장. 대시보드의 납품매출(SD_ZASSDDV0020)과 **기준이 다르므로 섞어 비교하지 말 것.** */
const SALES_TABLE = '`harimfood-361004.harim_sap_bi.SD_SO`';

/** 유통채널 — SAP VTWEG. 10=내수 20=수출 */
export type SalesVtweg = 'ALL' | '10' | '20';

/**
 * 제품 구분 — **자재코드 앞자리 대역**으로 가른다. 이 앱 전체가 쓰는 규칙과 같다
 * (`lib/bom/explosion-sql.ts` MATERIAL_CLASS_LABEL, `lib/weekly/classification.ts` isMerchandiseMaterial).
 *
 * ⚠️ **MTART 를 읽지 않고 대역 하나로 판정한다.** 실측(2025-09-01~2026-08-31) 결과 둘이 예외 없이 일치한다 —
 * 5 대역 1,739품목 전부 FERT(1,251.3억), 6 대역 864품목 전부 HAWA(53.8억),
 * 나머지 1·2·3·4 대역 94품목이 ROH1·ROH2·ROH3·HALB(3.4억)다.
 * 대역이 스코프라는 규칙을 화면마다 다시 쓰지 않기 위한 것이므로 MTART 기준으로 되돌리지 말 것.
 *
 * `ETC`(기타)는 완제품·상품이 아닌 자재를 판 매출이다 — 포장재·부재료·원재료·반제품.
 * 금액은 작지만(1년 3.4억) 완제품 매출에 섞이면 제품 표의 모수가 갈린다.
 */
export type SalesProductScope = 'ALL' | 'FERT' | 'HAWA' | 'ETC';

export const SALES_SCOPE_LABELS: Record<SalesProductScope, string> = {
  ALL: '전체',
  FERT: '완제품',
  HAWA: '상품',
  ETC: '기타',
};

export const SALES_SCOPE_KEYS: SalesProductScope[] = ['ALL', 'FERT', 'HAWA', 'ETC'];

/**
 * 구성비 차트가 쪼갤 수 있는 축.
 *
 * 앞의 둘(`team`·`salesChannel`)은 SD_SO 에 없는 값이다 — 자재 마스터(DISPO·제품계층 LV2)를
 * 따로 읽어 `lib/sales-report/segment.ts` 가 판정한다. `/weekly` 의 「팀별」·「채널별」과 **같은 기준**이다.
 * 나머지 넷은 SD_SO 의 텍스트 컬럼과 1:1 이다.
 *
 * ⚠️ `channel` 은 고객그룹1(KVGR1 — 온라인·대형마트·CVS·SSM…)이고 `salesChannel` 은
 * 제품계층 LV2 로 판정한 영업 채널(B2C·B2B·수출·NPB/PB)이다. **둘은 다른 축이다.**
 * 예전에 `channel` 을 「판매채널」이라 불렀는데 채널 축이 둘이 되면서 이름이 겹쳐 「고객그룹」으로 바꿨다.
 */
export type SalesDimension = 'team' | 'salesChannel' | 'channel' | 'brand' | 'matkl' | 'vkgrp';

export const SALES_DIMENSION_LABELS: Record<SalesDimension, string> = {
  team: '팀',
  salesChannel: '채널',
  channel: '고객그룹',
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
  /** 제품 구분(완제품/상품/기타). 조회 자체를 좁히므로 KPI·추이·구성비·제품표가 모두 같은 모수가 된다 */
  scope: SalesProductScope;
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
 * 표에 실어 보내는 제품 수 상한. **SQL 이 아니라 `buildSalesBoard` 에서 자른다.**
 *
 * ⚠️ 예전에는 `products` CTE 에 `ORDER BY net DESC LIMIT` 로 박혀 있었다. 그러면 팀·채널 축이
 * 제품 행을 접어 만들어지는 지금 구조에서 **축 합계가 총계보다 작아진다** — 잘려 나간 꼬리만큼
 * 비는데 화면에는 그 사실이 안 드러난다(전 기간 조회 시 자재 3,685종 > 상한 3,000).
 * 그래서 SQL 은 자재 전부를 돌려주고(3,685행이라 전송 비용은 무시할 수 있다),
 * 축 집계는 전체로 한 뒤 **표에 실을 행만** 여기서 자른다.
 *
 * 실측: 1년 조회에 자재 2,697종 / 직렬화 290KB(1,500행 기준). 3,000행이라도 캐시 항목
 * 2MB 제한에 한참 못 미친다. 더 올릴 거면 `npm run verify:sales` 의 크기 체크를 먼저 확인할 것.
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
        -- 제품 구분은 **여기 한 곳에서만** 건다. 표만 걸러 내면 KPI·추이·구성비가 전체 모수로 남아
        -- 「상품만」을 눌렀는데 상단 합계는 그대로인 화면이 된다.
        AND (
          @scope = 'ALL'
          OR (@scope = 'FERT' AND MATNR BETWEEN '50000000' AND '59999999')
          OR (@scope = 'HAWA' AND MATNR BETWEEN '60000000' AND '69999999')
          OR (@scope = 'ETC' AND NOT (MATNR BETWEEN '50000000' AND '69999999'))
        )
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
      -- ⚠️ 여기서 자르지 않는다. 팀·채널 축이 이 행들을 접어 만들어지므로 꼬리를 버리면
      --    축 합계가 총계와 어긋난다. 표에 실을 행 수는 buildSalesBoard 가 정한다.
      GROUP BY k1
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

// ─────────────────────────────────────────────────────────────
// 팀 판정용 자재 마스터
// ─────────────────────────────────────────────────────────────

/** 생산 플랜트. 여기 DISPO 만 생산라인을 뜻한다(1021=K1, 1022=K3, 1023=K2). */
const PRODUCTION_PLANTS = "'1021', '1022', '1023'";
/** 판매법인. DISPO 가 M33·M36 같은 영업 코드라 상품(H01) 폴백으로만 쓴다. */
const SALES_PLANT = "'1031'";

/**
 * SKU → DISPO 후보. 팀 축의 판정 원천이다.
 *
 * ⚠️ **`/weekly` 의 `buildDispoMasterQuery` 를 그대로 쓰면 안 된다.** 그쪽은 저장위치 마스터
 * (`MM_MARD`)만 보는데, 그 표에는 **저장위치가 붙은 자재만** 행이 있다. 재고를 세는 장표에서는
 * 그것으로 충분하지만(재고가 있으면 저장위치가 있다), 매출에는 **재고 없이 팔린 SKU** 가 잔뜩 있다 —
 * 실측(2026-01-01~08-21) 완제품 매출 712.6억 중 **168.3억(23.6%)** 이 `MM_MARD` 에 생산 플랜트 행이
 * 없어 통째로 미분류로 떨어졌다([CVS] 하림 맥시칸 핫크리스피 7.4억 같은 실판매 SKU 들이다).
 *
 * 그래서 플랜트 단위 자재마스터 `SD_MARC` 를 **폴백으로** 더 본다. 미분류가 168.3억 → 13.0억(1.8%)로 준다.
 *
 * ⚠️ **폴백이지 우선순위가 아니다.** `MM_MARD` 에 생산 플랜트 DISPO 가 있으면 `SD_MARC` 는 보지 않는다 —
 * 그래야 `/weekly` 가 이미 분류하고 있는 SKU 의 팀이 이 화면에서 달라지지 않는다.
 * 실측으로 두 표의 후보 집합이 다른 자재가 131품목(매출 25.4억) 있고, 그중에는 `SD_MARC` 쪽에만
 * H01(상품)이 붙어 있어 순서를 뒤집으면 완제품이 상품 행으로 넘어가는 것이 섞여 있다.
 *
 * 후보를 고르는 규칙(`pickPrimaryDispo`·`pickFallbackDispo`)은 `/weekly` 와 **같은 순수 함수**를 쓴다.
 * 여기서 규칙까지 새로 쓰면 같은 자재가 두 화면에서 다른 팀에 잡힌다.
 */
export function buildSalesDispoMasterQuery(): string {
  const scope = `
    WHERE MATNR BETWEEN '50000000' AND '69999999'
      AND WERKS IN (${PRODUCTION_PLANTS}, ${SALES_PLANT})
      AND DISPO IS NOT NULL AND DISPO <> ''
    -- MM_MARD 는 저장위치 단위라 플랜트당 여러 번 나온다. 후보를 세기 전에 접는다.
    GROUP BY MATNR, WERKS, DISPO
  `;

  return `
    WITH merged AS (
      SELECT MATNR, WERKS, DISPO, 'MARD' AS src
      FROM \`harimfood-361004.harim_sap_bi.MM_MARD\`
      ${scope}
      UNION ALL
      SELECT MATNR, WERKS, DISPO, 'MARC' AS src
      FROM \`harimfood-361004.harim_sap_bi.SD_MARC\`
      ${scope}
    )
    SELECT
      MATNR,
      -- 순서는 플랜트 코드 오름차순이다. pickPrimaryDispo 가 「분류되는 첫 후보」를 고르므로
      -- 이 순서를 뒤집으면 분류되는 코드가 둘인 자재의 팀이 바뀐다.
      ARRAY_AGG(
        IF(src = 'MARD' AND WERKS IN (${PRODUCTION_PLANTS}), DISPO, NULL)
        IGNORE NULLS ORDER BY WERKS, DISPO
      ) AS MARD_CANDIDATES,
      ARRAY_AGG(
        IF(src = 'MARC' AND WERKS IN (${PRODUCTION_PLANTS}), DISPO, NULL)
        IGNORE NULLS ORDER BY WERKS, DISPO
      ) AS MARC_CANDIDATES,
      ARRAY_AGG(
        IF(WERKS = ${SALES_PLANT}, DISPO, NULL)
        IGNORE NULLS ORDER BY WERKS, DISPO
      ) AS SALES_CANDIDATES
    FROM merged
    GROUP BY MATNR
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
    scope: params.scope,
  };
}
