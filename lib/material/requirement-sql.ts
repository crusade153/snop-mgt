/**
 * 자재 소요량 집계 쿼리 — BOM 전개 × 생산실적을 BigQuery 안에서 접는다
 *
 * 왜 여기서 접는가:
 *   원·부자재까지 넓히면 (완제품 × 자재 × 공장) 리프가 51,666행 / 27MB 다.
 *   그걸 매 요청마다 Supabase 에서 1,000행씩 52번 나눠 받는 건 못 쓴다.
 *   반면 필요한 건 "자재별 소요량과 그게 어느 제품계층에서 왔는가"뿐이라,
 *   제품계층 단위로 접으면 17,881행으로 줄고 gzip 후 캐시 한 항목에 들어간다.
 *
 *   Supabase 마트(snop_bom_leaf)는 그대로 남는다 — 자재코드 하나로 완제품을 되짚는
 *   드릴다운은 인덱스 조회가 맞고, 거기서는 완제품별 상세가 필요하다.
 *
 * 담당자 귀속·위험 판정은 여기서 하지 않는다. 그건 lib/material/allocation.ts 의
 * 순수 함수로 남겨야 테스트 프레임워크 없이도 검증할 수 있다.
 */

import {
  buildBomExplosionCte,
  materialScopeFilter,
  type BomScope,
} from '@/lib/bom/explosion-sql';
import { DATASET, MATERIAL_SIMULATION_MONTHS } from '@/lib/material/queries';

const usageWindowColumns = MATERIAL_SIMULATION_MONTHS.map(
  (months) =>
    `SUM(IF(PROD_DATE >= DATE_SUB(PARSE_DATE('%Y%m%d', @toDate), INTERVAL ${months} MONTH), QTY, 0)) AS QTY_${months}`,
).join(',\n      ');

const requirementWindowColumns = MATERIAL_SIMULATION_MONTHS.map(
  (months) => `SUM(
    IF(
      l.FIXED_FLAG = 0 AND l.BAD_QTY_FLAG = 0 AND l.LOT_BASIS_FLAG = 0
        AND l.UOM_MISMATCH = 0 AND l.QTY_PER_FG > 0,
      l.QTY_PER_FG * IFNULL(u.QTY_${months}, 0),
      0
    )
  ) AS requirement_${months}`,
).join(',\n  ');

const activeProductWindowColumns = MATERIAL_SIMULATION_MONTHS.map(
  (months) =>
    `COUNT(DISTINCT IF(IFNULL(t.QTY_${months}, 0) > 0, l.ROOT, NULL)) AS active_product_count_${months}`,
).join(',\n  ');

/**
 * 쿼리 파라미터
 *   @maxLevel(INT64), @plants(ARRAY<STRING>)  — 전개 CTE 가 쓴다
 *   @fromDate, @toDate(STRING yyyyMMdd)       — 생산실적 집계 기간
 */
export function buildMaterialRequirementQuery(scope: BomScope = 'RAW_AND_PACKAGING'): string {
  return `
WITH RECURSIVE${buildBomExplosionCte()},

  -- 완제품 × 공장 생산실적. 자재 소요량의 분모이자 곱하는 값이다.
  -- ⚠️ 단위가 EA/KG/BOX 로 섞여 있어 BOX 실적은 EA 로 정규화한다. BOM 의 소요량은
  --    완제품 기본단위(SD_MARA.MEINS) 1개당 값이라 여기서 안 맞추면 박스 배수만큼 어긋난다.
  --    정규화 식은 actions/dashboard-actions.ts:43-49 와 동일하게 유지한다.
  -- ⚠️ 오더당 행이 대부분 1행이지만 공정별로 갈리는 경우가 있어 AUFNR 로 먼저 접는다.
  orders AS (
    SELECT
        P.AUFNR,
        ANY_VALUE(P.MATNR) AS MATNR,
        ANY_VALUE(P.WERKS) AS WERKS,
        ANY_VALUE(SAFE.PARSE_DATE('%Y%m%d', CAST(P.GSTRP AS STRING))) AS PROD_DATE,
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
  ),
  usage_by_plant AS (
    SELECT MATNR, WERKS,
      ${usageWindowColumns}
    FROM orders
    WHERE QTY > 0
    GROUP BY MATNR, WERKS
  ),
  -- 전 공장 합계. "이 완제품이 아예 안 만들어지고 있는가"(단종) 판정에 쓴다.
  -- 공장별 실적만 보면 다른 공장으로 생산이 옮겨간 제품을 단종으로 오판한다.
  usage_total AS (
    SELECT MATNR,
      ${usageWindowColumns}
    FROM orders
    WHERE QTY > 0
    GROUP BY MATNR
  ),

  -- (완제품 × 자재 × 공장) 리프. 마트에 적재되는 것과 같은 값이어야 한다.
  leaf AS (
    SELECT
      e.ROOT, e.WERKS, e.NODE,
      ANY_VALUE(e.BRAND) AS BRAND,
      ANY_VALUE(e.CATEGORY) AS CATEGORY,
      ANY_VALUE(e.FAMILY) AS FAMILY,
      ANY_VALUE(e.NODE_T) AS NODE_T,
      ANY_VALUE(e.COMP_UOM) AS COMP_UOM,
      ANY_VALUE(mm.MEINS) AS BASE_UOM,
      SUM(e.QTY) AS QTY_PER_FG,
      MAX(e.FIXED_FLAG) AS FIXED_FLAG,
      MAX(e.BAD_QTY_FLAG) AS BAD_QTY_FLAG,
      MAX(e.LOT_BASIS_FLAG) AS LOT_BASIS_FLAG,
      MAX(IF(mm.MEINS IS NOT NULL AND mm.MEINS != e.COMP_UOM, 1, 0)) AS UOM_MISMATCH
    FROM exp e
    LEFT JOIN \`${DATASET}.SD_MARA\` mm ON mm.MATNR = e.NODE
    WHERE ${materialScopeFilter(scope)}
    GROUP BY e.ROOT, e.WERKS, e.NODE
  )

SELECT
  l.NODE                        AS material_code,
  l.WERKS                       AS werks,
  ANY_VALUE(l.NODE_T)           AS material_name,
  SUBSTR(l.NODE, 1, 1)          AS material_class,
  ANY_VALUE(l.COMP_UOM)         AS bom_uom,
  ANY_VALUE(l.BASE_UOM)         AS base_uom,
  l.BRAND                       AS root_brand,
  l.CATEGORY                    AS root_category,
  l.FAMILY                      AS root_family,
  -- 3~12개월 누계를 한 번에 가져온다. 슬라이더를 움직일 때 BigQuery를 다시 호출하지 않는다.
  -- 계산 가능한 행만 더하고, 고정수량·파싱실패·기준수량 오등록·단위불일치는 제외한다.
  ${requirementWindowColumns},
  COUNT(DISTINCT l.ROOT)        AS product_count,
  -- 전 공장 기준으로 최근에 한 번이라도 만들어진 완제품 수. 0 이면 이 계층의 제품이
  -- 전부 생산 중단이라는 뜻이고, 그 자재는 사실상 폐기 후보다.
  ${activeProductWindowColumns},
  MAX(l.QTY_PER_FG)             AS max_qty_per_fg,
  MAX(l.FIXED_FLAG) = 1         AS has_fixed_qty,
  MAX(l.BAD_QTY_FLAG) = 1       AS has_bad_qty,
  MAX(l.LOT_BASIS_FLAG) = 1     AS suspect_lot_basis,
  MAX(l.UOM_MISMATCH) = 1       AS uom_mismatch
FROM leaf l
LEFT JOIN usage_by_plant u ON u.MATNR = l.ROOT AND u.WERKS = l.WERKS
LEFT JOIN usage_total t ON t.MATNR = l.ROOT
GROUP BY l.NODE, l.WERKS, l.BRAND, l.CATEGORY, l.FAMILY
`;
}
