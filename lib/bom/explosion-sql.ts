/**
 * BOM 다단계 전개 SQL — 완제품 1 기본단위(EA)당 자재 소요량을 뽑는다.
 *
 * 사내 두 앱에 절반씩 있던 로직을 합친 것이다.
 *   - 수량 전개(MENGE/BMENG/AUSCH/FMENG, 반제품 다단계) ← mrp/actions/bom.ts
 *   - PATH 기반 순환 가드                              ← purchase/actions/packaging-actions.ts
 * 어느 쪽도 혼자서는 "이 자재 재고로 완제품 몇 개"에 답하지 못한다.
 *
 * 실측(2026-08-07, PP_STPO 41,487행 / 부모 6,396 / 자식 8,065 / 공장 4):
 *   - DATUV 가 미래이거나 NULL 인 행 0건 → 이 테이블은 "현재 유효 BOM" 스냅샷이다.
 *     따라서 유효일자 필터는 걸지 않는다. 다만 (부모,공장,STLAL,POSNR) 이 2행 이상인
 *     키가 24행 존재하고 그중 하나는 8행이라, POSNR 단위 dedupe 는 반드시 한다.
 *   - 동일 자식이 여러 POSNR 로 갈라진 키가 1,018건 → 이건 "같은 자재를 두 번 투입"하는
 *     정상 구성이므로 반드시 SUM 해야 한다. purchase 처럼 DISTINCT 를 쓰면 물량이 샌다.
 *   - 완제품(FERT, 미사용 제외) 2,950 중 BOM 보유 2,231(75.6%). 나머지는 상품·외주다.
 */

/**
 * 전개 깊이 상한.
 * 포장재만 볼 때는 8이면 충분했지만(상한 도달 24행), 원·부자재는 반제품 단계가
 * 더 깊어 8에서 603행이 잘렸다. 잘리면 그만큼 소요량이 누락된다.
 * 순환 가드(PATH)가 무한 전개를 막으므로 상한을 올리는 것 자체는 안전하다.
 */
export const MAX_BOM_LEVEL = 14;

export type BomScope = 'PACKAGING' | 'RAW_AND_PACKAGING';

/** 자재대역 앞자리 → 자재 구분. mrp/lib/bom-utils.ts 의 분류를 따른다. */
export const MATERIAL_CLASS_LABEL: Record<string, string> = {
  '1': '원재료',
  '2': '부재료',
  '3': '포장재',
  '4': '반제품',
  '5': '자사소재',
  '6': '상품',
  A: '정제수',
};

/** 화면 필터에 노출하는 자재 구분. 전개 스코프와 일치해야 한다. */
export const FILTERABLE_MATERIAL_CLASSES = ['1', '2', '3'] as const;

const SCOPE_FILTER: Record<BomScope, string> = {
  // 포장재만. 도입 초기에 "이 자재 = 이 완제품" 대응이 선명한 범위로 검증했다.
  PACKAGING: `SUBSTR(NODE, 1, 1) = '3'`,
  // 원재료·부재료·포장재 전부. 실측 51,666행(원 3,595 / 부 39,858 / 포장 8,213).
  RAW_AND_PACKAGING: `SUBSTR(NODE, 1, 1) IN ('1', '2', '3')`,
};

export function materialScopeFilter(scope: BomScope): string {
  return SCOPE_FILTER[scope];
}

/**
 * 전개 CTE 본문(WITH RECURSIVE 뒤에 오는 부분)만 돌려준다.
 * 리프 조회용 쿼리와 소요량 집계용 쿼리가 같은 전개를 공유해야 두 화면의 숫자가 갈리지 않는다.
 * 결과 테이블 이름은 `exp` 이고, 자재 구분 필터는 소비하는 쪽에서 건다.
 */
export function buildBomExplosionCte(): string {
  return `
  -- ① 같은 (부모,공장,STLAL,POSNR) 이 여러 행인 경우 최신 DATUV 한 행만 남긴다.
  --    실측 24행뿐이지만 8행짜리 키가 있어 그대로 SUM 하면 8배가 된다.
  stpo AS (
    SELECT * FROM (
      SELECT
        MATNR, MATNR_T, WERKS, STLAL, POSNR, IDNRK, IDNRK_T,
        MENGE, BMENG, AUSCH, FMENG, MEINS, DATUV,
        ROW_NUMBER() OVER (
          PARTITION BY MATNR, WERKS, STLAL, POSNR
          ORDER BY DATUV DESC
        ) AS rn
      FROM \`harimfood-361004.harim_sap_bi.PP_STPO\`
      WHERE IDNRK IS NOT NULL AND TRIM(IDNRK) != ''
        -- ⚠️ BigQuery 는 빈 배열 파라미터를 NULL 로 넘긴다. ARRAY_LENGTH(NULL) 은 NULL 이라
        --    IFNULL 없이 쓰면 WHERE 전체가 NULL 이 되어 0행이 나온다.
        AND (IFNULL(ARRAY_LENGTH(@plants), 0) = 0 OR WERKS IN UNNEST(@plants))
    )
    WHERE rn = 1
  ),

  -- ② BOM 버전. 조직 전체 관례가 MIN(STLAL) 이라 값은 그대로 따르되,
  --    대안 BOM 개수를 세어 마트에 신뢰도로 싣는다(실측 123건, 1.7%).
  minbom AS (
    SELECT MATNR, WERKS, MIN(STLAL) AS STLAL, COUNT(DISTINCT STLAL) AS STLAL_CNT
    FROM stpo GROUP BY MATNR, WERKS
  ),

  -- ③ 부모 1 기본단위당 자식 소요계수.
  --    ⚠️ GROUP BY + SUM 이어야 한다. 동일 자식이 여러 POSNR 로 나뉜 정상 구성이
  --       1,018건 있어 DISTINCT 를 쓰면 그만큼 물량이 샌다.
  --    ⚠️ FMENG='X'(로트 고정수량, 563행)는 부모 수량과 무관해서 "완제품 1EA당"
  --       계수로 환산할 수 없다. 계수 0 + 플래그로 분리한다. mrp 처럼 MENGE 를
  --       그대로 쓰면 완제품 1개당 소요가 로트 전량으로 잡혀 재고가 넉넉해도
  --       "0개 생산 가능"이 나온다.
  --    ⚠️ MENGE 는 STRING 이고 파싱 불가 63행이 있다 → 0 처리 + 플래그.
  bom AS (
    SELECT
      s.MATNR, s.WERKS, s.IDNRK,
      ANY_VALUE(s.IDNRK_T) AS IDNRK_T,
      ANY_VALUE(s.MEINS)   AS COMP_UOM,
      SUM(
        CASE
          WHEN UPPER(TRIM(IFNULL(s.FMENG, ''))) = 'X' THEN 0
          ELSE IFNULL(
                 SAFE_DIVIDE(SAFE_CAST(s.MENGE AS FLOAT64), NULLIF(s.BMENG, 0))
                 * (1 + IFNULL(s.AUSCH, 0) / 100),
                 0)
        END
      ) AS QTY_PER,
      MAX(CASE WHEN UPPER(TRIM(IFNULL(s.FMENG, ''))) = 'X' THEN 1 ELSE 0 END) AS HAS_FIXED,
      MAX(CASE WHEN SAFE_CAST(s.MENGE AS FLOAT64) IS NULL THEN 1 ELSE 0 END) AS HAS_BAD_QTY,
      -- ⚠️ 기준수량 오등록 감지. BMENG(기준수량)이 1인데 자식 소요가 100을 넘으면
      --    그 BOM 은 "완제품 1개 기준"이 아니라 로트 기준으로 등록된 것이다.
      --    실례: 50003114(수출 불소라면)는 BMENG=1 인데 액상스프 3,475EA·칼라박스 347EA
      --    → 실제로는 3,475봉지 로트 기준이고, 나눠보면 봉지당 스프 1개·박스 0.1개로 맞는다.
      --    이대로 쓰면 소요량이 로트 배수만큼 부풀려지므로 표시해서 계산에서 걸러낸다.
      --    실측: 이런 부모는 전체 6,396개 중 11개뿐이다(BMENG=1 & 자식수량 100 초과).
      MAX(CASE WHEN s.BMENG = 1 AND SAFE_CAST(s.MENGE AS FLOAT64) > 100 THEN 1 ELSE 0 END) AS HAS_LOT_BASIS
    FROM stpo s
    JOIN minbom m
      ON m.MATNR = s.MATNR AND m.WERKS = s.WERKS AND m.STLAL = s.STLAL
    GROUP BY s.MATNR, s.WERKS, s.IDNRK
  ),

  -- ④ 루트 = 살아있는 완제품.
  --    ⚠️ '%미사용%' 제외 필수 — FERT 4,517건 중 1,567건이 미사용이다.
  --    ⚠️ 앱 전체 유니버설 스코프(5000만~6999만)를 유지해 다른 화면과 모수를 맞춘다.
  roots AS (
    SELECT MATNR, MATNR_T, MEINS AS ROOT_UOM,
           PRDHA_1, PRDHA_1_T, PRDHA_2, PRDHA_2_T, PRDHA_3, PRDHA_3_T
    FROM \`harimfood-361004.harim_sap_bi.SD_MARA\`
    WHERE MTART = 'FERT'
      AND MATNR BETWEEN '50000000' AND '69999999'
      AND IFNULL(MATNR_T, '') NOT LIKE '%미사용%'
  ),

  exp AS (
    -- [Anchor] 완제품 1 EA 기준
    SELECT
      r.MATNR AS ROOT, r.MATNR_T AS ROOT_T, r.ROOT_UOM,
      r.PRDHA_1_T AS BRAND, r.PRDHA_2_T AS CATEGORY, r.PRDHA_3_T AS FAMILY,
      b.WERKS, b.IDNRK AS NODE, b.IDNRK_T AS NODE_T, b.COMP_UOM,
      1 AS LVL,
      CONCAT('>', r.MATNR, '>', b.IDNRK, '>') AS PATH,
      '(직접)' AS VIA,
      b.QTY_PER AS QTY,
      b.HAS_FIXED AS FIXED_FLAG,
      b.HAS_BAD_QTY AS BAD_QTY_FLAG,
      b.HAS_LOT_BASIS AS LOT_BASIS_FLAG,
      mb.STLAL_CNT AS ALT_CNT
    FROM roots r
    JOIN bom b ON b.MATNR = r.MATNR
    JOIN minbom mb ON mb.MATNR = b.MATNR AND mb.WERKS = b.WERKS

    UNION ALL

    -- [Recursive] 반제품(4*)을 거쳐 내려간다. 부모 소요량에 자식 계수를 곱해 누적.
    SELECT
      e.ROOT, e.ROOT_T, e.ROOT_UOM, e.BRAND, e.CATEGORY, e.FAMILY,
      e.WERKS, b.IDNRK, b.IDNRK_T, b.COMP_UOM,
      e.LVL + 1,
      CONCAT(e.PATH, b.IDNRK, '>'),
      CONCAT(IF(e.VIA = '(직접)', '', CONCAT(e.VIA, ' > ')), e.NODE),
      e.QTY * b.QTY_PER,
      GREATEST(e.FIXED_FLAG, b.HAS_FIXED),
      GREATEST(e.BAD_QTY_FLAG, b.HAS_BAD_QTY),
      GREATEST(e.LOT_BASIS_FLAG, b.HAS_LOT_BASIS),
      GREATEST(e.ALT_CNT, mb.STLAL_CNT)
    FROM exp e
    JOIN bom b ON b.MATNR = e.NODE AND b.WERKS = e.WERKS
    JOIN minbom mb ON mb.MATNR = b.MATNR AND mb.WERKS = b.WERKS
    WHERE e.LVL < @maxLevel
      -- 🔒 순환 가드. 멀티팩·기획세트에서 완제품(5*)이 다른 완제품의 자식으로
      --    들어오는 구성이 실제로 있다(자식 5* 1,053종). 이 가드가 없으면
      --    무한 전개 + 중복 계산이 난다. mrp 쿼리에는 없는 부분이다.
      AND STRPOS(e.PATH, CONCAT('>', b.IDNRK, '>')) = 0
  )
`;
}

/**
 * 리프 조회용 전개 쿼리 — (완제품 × 자재 × 공장) 1행.
 * 쿼리 파라미터: @maxLevel(INT64), @plants(ARRAY<STRING>, 빈 배열이면 전 공장)
 */
export function buildBomExplosionQuery(scope: BomScope = 'RAW_AND_PACKAGING'): string {
  return `
WITH RECURSIVE${buildBomExplosionCte()}
SELECT
  e.ROOT                          AS root_matnr,
  ANY_VALUE(e.ROOT_T)             AS root_name,
  ANY_VALUE(e.BRAND)              AS root_brand,
  ANY_VALUE(e.CATEGORY)           AS root_category,
  ANY_VALUE(e.FAMILY)             AS root_family,
  ANY_VALUE(e.ROOT_UOM)           AS root_uom,
  e.WERKS                         AS werks,
  e.NODE                          AS material_code,
  ANY_VALUE(e.NODE_T)             AS material_name,
  SUBSTR(e.NODE, 1, 1)            AS material_class,
  ANY_VALUE(e.COMP_UOM)           AS bom_uom,
  ANY_VALUE(mm.MEINS)             AS base_uom,
  -- MARM(단위환산) 테이블이 사내에 없다. 추정하지 않고 불일치를 표시만 한다.
  -- 실측: 포장재 2,744쌍 중 불일치 1건, 마스터 누락 0건.
  MAX(IF(mm.MEINS IS NOT NULL AND mm.MEINS != e.COMP_UOM, TRUE, FALSE)) AS uom_mismatch,
  SUM(e.QTY)                      AS qty_per_fg,
  MAX(e.FIXED_FLAG) = 1           AS has_fixed_qty,
  MAX(e.BAD_QTY_FLAG) = 1         AS has_bad_qty,
  MAX(e.LOT_BASIS_FLAG) = 1       AS suspect_lot_basis,
  MAX(e.ALT_CNT)                  AS stlal_count,
  MIN(e.LVL)                      AS min_level,
  MAX(e.LVL)                      AS max_level,
  COUNT(*)                        AS path_count,
  MAX(e.LVL) >= @maxLevel         AS hit_depth_cap,
  ARRAY_AGG(DISTINCT e.VIA IGNORE NULLS LIMIT 5) AS via_paths
FROM exp e
LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` mm ON mm.MATNR = e.NODE
WHERE ${SCOPE_FILTER[scope]}
GROUP BY e.ROOT, e.WERKS, e.NODE
`;
}
