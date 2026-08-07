/**
 * 자재 사실 데이터의 쿼리와 행 변환 — 순수 함수만 둔다.
 *
 * 실행·캐시는 actions/material-actions.ts 가 맡는다. 여기에 I/O 를 두지 않는 이유는
 * 이 저장소에 테스트 프레임워크가 없어서 scripts/*.mjs 로만 검증할 수 있는데,
 * 'use server' 파일은 Next 런타임 밖에서 로드되지 않기 때문이다.
 */

import type { MaterialFact, MaterialRequirementRow, ProductUsage } from '@/types/material';

export const DATASET = 'harimfood-361004.harim_sap_bi';

/** 납기가 이만큼 넘게 지난 미입고 발주는 미정리 잔재로 보고 제외한다(purchase 관례). */
export const PO_OVERDUE_CUTOFF_DAYS = 30;
export const MATERIAL_SIMULATION_MONTHS = Array.from({ length: 10 }, (_, index) => index + 3);

/**
 * 다루는 자재 대역 — 1=원재료 2=부재료 3=포장재.
 * BOM 전개 스코프(RAW_AND_PACKAGING)와 반드시 같아야 재고·발주와 소요량의 모수가 맞는다.
 */
export const MATERIAL_CLASSES = ['1', '2', '3'] as const;

const CLASS_IN = MATERIAL_CLASSES.map((code) => `'${code}'`).join(', ');

export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const raw =
    typeof value === 'object' && value !== null && 'value' in value
      ? (value as { value: unknown }).value
      : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRequirementQuantity(value: unknown): number {
  return Math.round(toNumber(value) * 1_000_000) / 1_000_000;
}

/**
 * 자재 재고 + 마스터 단가.
 * ⚠️ MM_MARD 에는 단위 컬럼이 없어 MM_ZMMR1140.MEINS 로 보완한다.
 * ⚠️ MM_ZMMR1140.WERKS 는 INT64, MM_MARD.WERKS 는 STRING 이라 CAST 가 필요하다.
 * ⚠️ 같은 테이블의 NAME1 은 공급업체가 아니라 플랜트명("하림산업 1공장")이다. 쓰지 않는다.
 */
export function buildMaterialStockQuery(): string {
  const actualUsageColumns = MATERIAL_SIMULATION_MONTHS.map(
    (months) => `GREATEST(SUM(IF(
          BUDAT >= FORMAT_DATE('%Y%m%d', DATE_SUB(PARSE_DATE('%Y%m%d', @toDate), INTERVAL ${months} MONTH)),
          CASE WHEN BWART = '261' THEN ABS(IFNULL(ERFMG, 0)) ELSE -ABS(IFNULL(ERFMG, 0)) END,
          0
        )), 0) AS ACTUAL_USAGE_${months}`,
  ).join(',\n        ');

  return `
    WITH stock AS (
      SELECT
        WERKS,
        MATNR,
        ANY_VALUE(MATNR_T) AS MATNR_T,
        SUM(IFNULL(LABST, 0)) AS ON_HAND,
        SUM(IFNULL(INSME, 0)) AS QUALITY_STOCK,
        SUM(IFNULL(SPEME, 0)) AS BLOCKED_STOCK
      FROM \`${DATASET}.MM_MARD\`
      WHERE SUBSTR(MATNR, 1, 1) IN (${CLASS_IN})
      GROUP BY WERKS, MATNR
    ),
    usage AS (
      SELECT
        WERKS,
        MATNR,
        ${actualUsageColumns}
      FROM \`${DATASET}.MM_MB51\`
      WHERE BWART IN ('261', '262')
        AND BUDAT BETWEEN @fromDate AND @toDate
        AND SUBSTR(MATNR, 1, 1) IN (${CLASS_IN})
      GROUP BY WERKS, MATNR
    ),
    master AS (
      SELECT
        CAST(WERKS AS STRING) AS WERKS,
        MATNR,
        ANY_VALUE(MEINS) AS MEINS,
        MAX(IFNULL(VERPR, 0)) AS VERPR,
        MAX(IFNULL(PLIFZ, 0)) AS PLIFZ
      FROM \`${DATASET}.MM_ZMMR1140\`
      WHERE SUBSTR(MATNR, 1, 1) IN (${CLASS_IN})
      GROUP BY 1, 2
    )
    SELECT
      s.WERKS, s.MATNR, s.MATNR_T, s.ON_HAND, s.QUALITY_STOCK, s.BLOCKED_STOCK,
      IFNULL(m.MEINS, '') AS MEINS,
      IFNULL(m.VERPR, 0) AS VERPR,
      IFNULL(m.PLIFZ, 0) AS PLIFZ,
      ${MATERIAL_SIMULATION_MONTHS.map((months) => `IFNULL(u.ACTUAL_USAGE_${months}, 0) AS ACTUAL_USAGE_${months}`).join(',\n      ')}
    FROM stock s
    LEFT JOIN master m ON m.MATNR = s.MATNR AND m.WERKS = s.WERKS
    LEFT JOIN usage u ON u.MATNR = s.MATNR AND u.WERKS = s.WERKS
    WHERE s.ON_HAND != 0 OR s.QUALITY_STOCK != 0 OR s.BLOCKED_STOCK != 0
  `;
}

/**
 * 미입고 발주.
 * ⚠️ MM_ZMMR0020 은 PO 아이템 한 건이 입고문서마다 반복된다.
 *    실측 158,941행 / 고유 아이템 46,174건 = 3.44배. EBELN+EBELP 로 먼저 접지 않으면
 *    발주 잔량과 금액이 그만큼 부풀려진다. 이 GROUP BY 가 이 쿼리의 전부다.
 * ⚠️ MATNR·WERKS 가 INT64 라 STRING 으로 CAST 해야 다른 테이블과 붙는다.
 */
export function buildOpenPoQuery(): string {
  return `
    WITH po AS (
      SELECT
        MIN(EINDT) AS EINDT_N,
        EBELN, EBELP,
        CAST(ANY_VALUE(MATNR) AS STRING) AS MATNR,
        CAST(ANY_VALUE(WERKS) AS STRING) AS WERKS,
        MAX(MENGE) AS MENGE,
        SUM(CASE WHEN BWART = 102 THEN -IFNULL(MENGE_GR, 0) ELSE IFNULL(MENGE_GR, 0) END) AS GR_QTY,
        IFNULL(ANY_VALUE(NETPR), 0) AS NETPR
      FROM \`${DATASET}.MM_ZMMR0020\`
      GROUP BY EBELN, EBELP
    )
    SELECT
      WERKS, MATNR,
      COUNT(*) AS OPEN_COUNT,
      SUM(MENGE - GR_QTY) AS OPEN_QTY,
      SUM((MENGE - GR_QTY) * NETPR) AS OPEN_VALUE,
      COUNTIF(EINDT_N < @todayInt) AS OVERDUE_COUNT
    FROM po
    WHERE MENGE > GR_QTY
      AND SUBSTR(MATNR, 1, 1) IN (${CLASS_IN})
      AND EINDT_N >= @overdueCutoff
    GROUP BY WERKS, MATNR
  `;
}

/**
 * 완제품별 생산실적. 자재 소요비중과 월평균소요의 분모다.
 *
 * ⚠️ 수량 단위가 EA/KG/BOX 로 섞여 있다(실측: 2공장은 셋 다 나온다).
 *    BOM 의 qty_per_fg 는 완제품 기본단위(SD_MARA.MEINS) 1개당 값이므로 BOX 로 기록된
 *    실적을 EA 로 정규화하지 않으면 소요량이 박스 배수만큼 어긋난다. 정규화 식은
 *    actions/dashboard-actions.ts:43-49 와 동일하게 맞춘다(자재 기본단위 자체가 BOX 인
 *    제품은 곱하지 않는 조건까지 포함).
 * ⚠️ 오더당 행은 실측상 거의 1행이지만(6,856건 중 52건만 2행) 공정별로 갈리는 경우가
 *    있어 AUFNR 로 접는다. 접기 전후 합계 차이는 1.00005 배 수준이다.
 */
export function buildProductUsageQuery(): string {
  return `
    WITH orders AS (
      SELECT
        P.AUFNR,
        ANY_VALUE(P.MATNR) AS MATNR,
        ANY_VALUE(P.WERKS) AS WERKS,
        ANY_VALUE(P.MEINS) AS SRC_UNIT,
        MAX(
          CASE
            WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.LMNGA * IFNULL(M.UMREZ_BOX, 1)
            ELSE P.LMNGA
          END
        ) AS QTY
      FROM \`${DATASET}.PP_ZASPPR1110\` AS P
      LEFT JOIN \`${DATASET}.SD_MARA\` AS M ON M.MATNR = P.MATNR
      WHERE P.GSTRP BETWEEN @fromDate AND @toDate
        AND P.MATNR BETWEEN '50000000' AND '69999999'
      GROUP BY P.AUFNR
    )
    SELECT
      MATNR, WERKS,
      SUM(QTY) AS ACTUAL_QTY,
      STRING_AGG(DISTINCT SRC_UNIT) AS UNITS
    FROM orders
    WHERE QTY > 0
    GROUP BY MATNR, WERKS
  `;
}

const keyOf = (werks: string, code: string) => `${werks}|${code}`;

/** 재고 행과 발주 행을 자재×공장 키로 합친다. */
export function mergeMaterialFacts(
  stockRows: Record<string, unknown>[],
  poRows: Record<string, unknown>[],
): MaterialFact[] {
  const facts = new Map<string, MaterialFact>();

  for (const row of stockRows) {
    const werks = String(row.WERKS ?? '');
    const materialCode = String(row.MATNR ?? '');
    const onHand = toNumber(row.ON_HAND);
    const qualityStock = toNumber(row.QUALITY_STOCK);
    const blockedStock = toNumber(row.BLOCKED_STOCK);
    const unitPrice = toNumber(row.VERPR);
    const leadTime = toNumber(row.PLIFZ);
    facts.set(keyOf(werks, materialCode), {
      materialCode,
      materialName: String(row.MATNR_T ?? ''),
      werks,
      onHand,
      qualityStock,
      blockedStock,
      actualUsageByMonths: Object.assign(
        Array<number>(13).fill(0),
        Object.fromEntries(
          MATERIAL_SIMULATION_MONTHS.map((months) => [
            months,
            toRequirementQuantity(row[`ACTUAL_USAGE_${months}`]),
          ]),
        ),
      ),
      unit: String(row.MEINS ?? '') || 'EA',
      unitPrice,
      stockValue: onHand * unitPrice,
      openPoQty: 0,
      openPoValue: 0,
      openPoCount: 0,
      overduePoCount: 0,
      leadTimeDays: leadTime > 0 ? leadTime : null,
    });
  }

  for (const row of poRows) {
    const werks = String(row.WERKS ?? '');
    const materialCode = String(row.MATNR ?? '');
    const openPoQty = toNumber(row.OPEN_QTY);
    const openPoValue = toNumber(row.OPEN_VALUE);
    const openPoCount = toNumber(row.OPEN_COUNT);
    const overduePoCount = toNumber(row.OVERDUE_COUNT);
    const existing = facts.get(keyOf(werks, materialCode));

    if (existing) {
      existing.openPoQty = openPoQty;
      existing.openPoValue = openPoValue;
      existing.openPoCount = openPoCount;
      existing.overduePoCount = overduePoCount;
      continue;
    }
    // 재고는 0인데 발주만 걸린 자재. "과다발주" 판정에 반드시 필요하다.
    facts.set(keyOf(werks, materialCode), {
      materialCode,
      materialName: '',
      werks,
      onHand: 0,
      qualityStock: 0,
      blockedStock: 0,
      actualUsageByMonths: Array<number>(13).fill(0),
      unit: 'EA',
      unitPrice: 0,
      stockValue: 0,
      openPoQty,
      openPoValue,
      openPoCount,
      overduePoCount,
      leadTimeDays: null,
    });
  }

  return [...facts.values()];
}

/** buildMaterialRequirementQuery 결과 → 도메인 타입 */
export function toMaterialRequirements(rows: Record<string, unknown>[]): MaterialRequirementRow[] {
  return rows.map((row) => ({
    materialCode: String(row.material_code ?? ''),
    werks: String(row.werks ?? ''),
    materialName: String(row.material_name ?? ''),
    materialClass: String(row.material_class ?? ''),
    bomUom: String(row.bom_uom ?? ''),
    baseUom: String(row.base_uom ?? ''),
    rootBrand: String(row.root_brand ?? ''),
    rootCategory: String(row.root_category ?? ''),
    rootFamily: String(row.root_family ?? ''),
    requirementsByMonths: Object.assign(
      Array<number>(13).fill(0),
      Object.fromEntries(
        MATERIAL_SIMULATION_MONTHS.map((months) => [
          months,
          toRequirementQuantity(row[`requirement_${months}`]),
        ]),
      ),
    ),
    productCount: toNumber(row.product_count),
    activeProductCountsByMonths: Object.assign(
      Array<number>(13).fill(0),
      Object.fromEntries(
        MATERIAL_SIMULATION_MONTHS.map((months) => [
          months,
          Math.round(toNumber(row[`active_product_count_${months}`])),
        ]),
      ),
    ),
    maxQtyPerFg: toNumber(row.max_qty_per_fg),
    hasFixedQty: Boolean(row.has_fixed_qty),
    hasBadQty: Boolean(row.has_bad_qty),
    suspectLotBasis: Boolean(row.suspect_lot_basis),
    uomMismatch: Boolean(row.uom_mismatch),
  }));
}

export function toProductUsage(rows: Record<string, unknown>[]): ProductUsage[] {
  return rows.map((row) => ({
    matnr: String(row.MATNR ?? ''),
    werks: String(row.WERKS ?? ''),
    actualQty: toNumber(row.ACTUAL_QTY),
    sourceUnit: String(row.UNITS ?? ''),
  }));
}
