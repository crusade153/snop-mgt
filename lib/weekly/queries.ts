/**
 * 주간 장표 적재용 SQL 문자열 생성 — I/O 없는 순수 함수
 *
 * 기존 대시보드 쿼리를 재사용하지 않고 따로 쓴다. 이유는 두 가지다.
 *  1) 대시보드는 저장위치 9개를 통째로 제외한다. 이 장표는 그 창고들을 `기타 창고` 그룹으로 **살려서** 보여준다.
 *  2) 이 장표는 배치 단위가 아니라 SKU × 창고그룹 단위로 접어 적재하므로 필요한 컬럼이 다르다.
 *
 * 주 1회만 도는 쿼리라 비용은 무시할 수 있다. 적재 이후 화면은 Supabase 만 읽는다.
 */

const DATASET = 'harimfood-361004.harim_sap_bi';
const USER_DATASET = 'harimfood-361004.harim_sap_bi_user';

/** 완제품·상품 자재 대역. 코드가 모두 8자리라 문자열 비교로 충분하다. */
const MATNR_FROM = '50000000';
const MATNR_TO = '69999999';

/**
 * 생산 플랜트만 DISPO 가 생산라인을 뜻한다.
 *
 * 1031(판매법인)의 DISPO 는 M33·M36·H01 같은 영업용 코드라 생산라인이 아니다.
 * 여기에 1031 을 섞으면 같은 자재가 영업 코드로 덮여 카테고리가 통째로 어긋난다.
 */
const PRODUCTION_PLANTS = ["'1021'", "'1022'", "'1023'"].join(', ');

/**
 * 판매법인. 여기 DISPO 는 생산라인이 아니라 영업 코드(M33·M36)라 **폴백으로만** 쓴다.
 * 받아들이는 것은 상품(H01) 하나뿐이고, 판단은 `pickFallbackDispo` 가 한다.
 */
const SALES_PLANT = "'1031'";

/**
 * SKU → DISPO 마스터. **후보를 전부 돌려준다.**
 *
 * 배치재고(MM_MCHB)에 DISPO 가 붙어 있지만 FBH 물류센터 재고에는 없다.
 * 그래서 자재재고 마스터(MM_MARD)에서 생산 플랜트 기준 DISPO 를 한 번 뽑아 두 쪽에 모두 붙인다.
 *
 * ⚠️ **한 자재가 플랜트마다 다른 DISPO 를 갖는다**(실측 836품목 중 72품목).
 * 예전에는 플랜트 코드 순 첫 건을 대표값으로 굳혔는데, 그 첫 건이 하필 미매핑 코드면
 * 뒤에 멀쩡한 라인 코드가 있어도 통째로 `기타` 로 떨어졌다 —
 * 실측 50001591(더미식 백미밥)은 `1022:M18`(미매핑) + `1023:M30`(즉석밥)인데 M18 이 대표가 돼
 * 즉석밥이 아니라 미분류로 잡혔다. 이런 품목이 53개·재고금액 9.9억이었다.
 * 그래서 여기서는 고르지 않고 후보를 플랜트 코드 순으로 전부 넘기고,
 * 대표값 선택은 `pickPrimaryDispo`(lib/weekly/classification.ts) 순수 함수가 한다.
 *
 * 판매법인(1031) 후보는 **별도 배열로** 넘긴다. 생산 후보와 섞으면 영업 코드가 생산라인 자리를
 * 차지하므로, 생산 후보가 아예 없을 때만 `pickFallbackDispo` 가 상품(H01)에 한해 꺼내 쓴다.
 */
export function buildDispoMasterQuery(): string {
  return `
    WITH master AS (
      SELECT MATNR, WERKS, DISPO
      FROM \`${DATASET}.MM_MARD\`
      WHERE MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
        AND WERKS IN (${PRODUCTION_PLANTS}, ${SALES_PLANT})
        AND DISPO IS NOT NULL AND DISPO <> ''
      -- 저장위치 단위 행이라 플랜트당 여러 번 나온다. 후보를 세기 전에 접는다.
      GROUP BY MATNR, WERKS, DISPO
    )
    SELECT
      MATNR,
      ARRAY_AGG(
        IF(WERKS IN (${PRODUCTION_PLANTS}), STRUCT(DISPO, WERKS), NULL)
        IGNORE NULLS ORDER BY WERKS, DISPO
      ) AS CANDIDATES,
      ARRAY_AGG(
        IF(WERKS = ${SALES_PLANT}, STRUCT(DISPO, WERKS), NULL)
        IGNORE NULLS ORDER BY WERKS, DISPO
      ) AS SALES_CANDIDATES
    FROM master
    GROUP BY MATNR
  `;
}

/**
 * SKU → 품명·기본단위 마스터.
 *
 * ⚠️ **품명을 재고 행에서만 주우면 안 된다.** 원래 이 장표는 배치재고(`V_MM_MCHB_ALL`)와
 * FBH 재고(`V_WMV_CST_INVNLIST`)가 실어 오는 `MATNR_T` 만 썼다. 그래서 **재고가 0 이고
 * 출고·생산만 있는 SKU 는 이름을 얻을 곳이 없어 품명 칸에 자재코드가 그대로 찍혔다**
 * (실측 2026-09-06 주차 90품목 — 전부 재고 0 인 흐름 전용 행이다).
 * 자재마스터에 이름이 없는 게 아니라 이 장표가 마스터를 안 본 것이었다:
 * 그 90품목 전부 `SD_MARA` 에 이름이 있고 「미사용」 별칭도 섞여 있지 않았다.
 *
 * 그래서 마스터를 따로 한 번 읽어 **재고 행이 못 채운 이름의 폴백**으로 쓴다.
 * 재고 행의 이름을 덮지는 않는다 — 배치재고 쪽이 실제 그 재고에 붙어 있던 표기이기 때문이다.
 */
export function buildWeeklyMaterialNameQuery(): string {
  return `
    SELECT
      MATNR,
      ANY_VALUE(MATNR_T) AS MATNR_T,
      ANY_VALUE(MEINS) AS MEINS
    FROM \`${DATASET}.SD_MARA\`
    WHERE MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
      AND MATNR_T IS NOT NULL AND MATNR_T <> ''
    GROUP BY MATNR
  `;
}

/**
 * 플랜트 배치재고 — **저장위치를 제외하지 않는다.**
 *
 * 기존 화면들은 여기서 9개 저장위치를 잘라냈다. 이 장표는 잘라내는 대신 LGORT 를 그대로 들고 나가
 * `lib/weekly/classification.ts` 에서 `PLANT` / `OTHER` 로 나눈다.
 *
 * ⚠️ **WERKS 는 배치 마스터(MM_MCHB)에서 붙인다.** 재고 뷰(V_MM_MCHB_ALL)에는 WERKS 컬럼이 아예 없고,
 * 단가는 플랜트별로 다르다(`ending_inventory.byPlant`). 자재마스터(MM_MARD)의 대표 플랜트로 뭉뚱그리면
 * 같은 자재가 1021·1022 에 나뉘어 있을 때 `/stock` 과 재고금액이 갈린다 —
 * 실측 68품목·0.04억이 정확히 이 차이였다. 그래서 `/stock`(actions/dashboard-actions.ts)과 **같은 조인**을 쓴다.
 */
export function buildWeeklyPlantInventoryQuery(): string {
  return `
    WITH batch_master AS (
      SELECT
        MATNR,
        LGORT,
        CHARG,
        -- 한 배치가 여러 플랜트에 걸리면 플랜트 코드 순 첫 건. /stock 과 동일한 규칙이어야 한다.
        ARRAY_AGG(CAST(WERKS AS STRING) ORDER BY WERKS LIMIT 1)[OFFSET(0)] AS WERKS
      FROM \`${DATASET}.MM_MCHB\`
      WHERE MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
      GROUP BY MATNR, LGORT, CHARG
    )
    SELECT
      I.MATNR,
      ANY_VALUE(I.MATNR_T) AS MATNR_T,
      ANY_VALUE(I.MEINS) AS MEINS,
      I.LGORT,
      ANY_VALUE(I.LGOBE) AS LGOBE,
      B.WERKS,
      IFNULL(SUBSTR(REPLACE(CAST(I.VFDAT AS STRING), '-', ''), 1, 8), '') AS VFDAT,
      SUM(IFNULL(I.CLABS, 0)) AS CLABS,
      SUM(IFNULL(I.CINSM, 0)) AS CINSM,
      ANY_VALUE(I.remain_rate) AS remain_rate,
      ANY_VALUE(I.remain_day) AS remain_day
    FROM \`${USER_DATASET}.V_MM_MCHB_ALL\` AS I
    LEFT JOIN batch_master AS B
      ON I.MATNR = B.MATNR
      AND I.LGORT = B.LGORT
      AND IFNULL(I.CHARG, '') = IFNULL(B.CHARG, '')
    WHERE I.CLABS > 0
      AND I.MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
    GROUP BY I.MATNR, I.LGORT, B.WERKS, I.VFDAT
  `;
}

/**
 * FBH 물류센터 재고.
 *
 * ⚠️ SAP 저장위치 3000(물류창고)은 이 재고의 SAP 측 미러다(실측: 445품목 중 381품목이 FBH 에도 있음).
 * 그래서 3000 은 `기타 창고` 에서 제외한다 — 안 그러면 물류 재고를 두 번 센다.
 */
export function buildWeeklyFbhInventoryQuery(): string {
  return `
    SELECT
      SKU_CD AS MATNR,
      ANY_VALUE(MATNR_T) AS MATNR_T,
      ANY_VALUE(MEINS) AS MEINS,
      IFNULL(SUBSTR(REPLACE(CAST(PRDT_DATE_NEW AS STRING), '-', ''), 1, 8), '') AS PRDT_DATE_NEW,
      IFNULL(SUBSTR(REPLACE(CAST(VALID_DATETIME_NEW AS STRING), '-', ''), 1, 8), '') AS VALID_DATETIME_NEW,
      SUM(IFNULL(AVLB_QTY, 0)) AS AVLB_QTY,
      ANY_VALUE(REMAINING_DAY) AS REMAINING_DAY
    FROM \`${USER_DATASET}.V_WMV_CST_INVNLIST\`
    WHERE AVLB_QTY > 0
      AND SKU_CD BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
    GROUP BY SKU_CD, PRDT_DATE_NEW, VALID_DATETIME_NEW
  `;
}

/**
 * 주간 출고 — 납품 실적(LFIMG_LIPS)과 납품매출액(NETWR).
 *
 * 수량은 ADS 와 같은 기준(실제 나간 수량)을 쓰고, 금액은 원가단가로 따로 환산한다.
 * NETWR 은 「월매출 比」의 분모 전용이며 출고 금액과 섞지 않는다.
 * BOX 전기분은 SD_MARA.UMREZ_BOX 로 기본단위에 맞춘다.
 */
export function buildWeeklyShipmentQuery(fromCompact: string, toCompact: string): string {
  return `
    SELECT
      A.MATNR,
      SUM(
        CASE
          WHEN A.VRKME = 'BOX' AND IFNULL(M.MEINS, '') <> 'BOX'
            THEN IFNULL(A.LFIMG_LIPS, 0) * IFNULL(M.UMREZ_BOX, 1)
          ELSE IFNULL(A.LFIMG_LIPS, 0)
        END
      ) AS SHIPPED_QTY,
      SUM(IFNULL(A.NETWR, 0)) AS SALES_AMOUNT
    FROM \`${DATASET}.SD_ZASSDDV0020\` AS A
    LEFT JOIN \`${DATASET}.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${fromCompact}' AND '${toCompact}'
      AND A.MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
    GROUP BY A.MATNR
  `;
}

/**
 * 주간 생산 — MM_MB51 생산입고 101 − 취소 102.
 *
 * 생산오더 테이블(PP_ZASPPR1110)은 최근 건이 누락되어 실적 근거로 쓰지 않는다.
 * 취소가 입고를 넘기는 구간은 0 으로 막는다(음수 생산 금지).
 */
export function buildWeeklyProductionQuery(fromCompact: string, toCompact: string): string {
  return `
    SELECT
      B.MATNR,
      GREATEST(SUM(
        (CASE WHEN B.BWART = '101' THEN 1 ELSE -1 END) * ABS(IFNULL(B.ERFMG, 0)) *
        (CASE
          WHEN B.ERFME = 'BOX' AND IFNULL(M.MEINS, '') <> 'BOX' THEN IFNULL(M.UMREZ_BOX, 1)
          ELSE 1
        END)
      ), 0) AS PRODUCED_QTY
    FROM \`${DATASET}.MM_MB51\` AS B
    LEFT JOIN \`${DATASET}.SD_MARA\` AS M ON M.MATNR = B.MATNR
    WHERE B.BUDAT BETWEEN '${fromCompact}' AND '${toCompact}'
      AND B.BWART IN ('101', '102')
      AND B.AUFNR IS NOT NULL
      AND B.MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
    GROUP BY B.MATNR
  `;
}

/**
 * 당월 1일 ~ 주차 종료일의 **누적 출고** — 「월 출고 比 재고금액」의 분모.
 *
 * ⚠️ 수량(LFIMG_LIPS)을 뽑는 것이 핵심이다. 금액은 호출부에서 **완제품 재고단가**로 환산한다.
 * 예전에는 매출액(NETWR)을 분모로 썼는데, 분자인 재고금액은 원가이고 분모는 판매가라
 * 마진율만큼 비율이 눌려 "재고가 몇 주치인가"로 읽을 수 없었다.
 * NETWR 도 함께 돌려주며 별도 「월 매출 比 재고금액」의 분모로 쓴다.
 *
 * 주간 출고와 완전히 같은 기준(VDATU, BOX 환산)이어야 두 열을 나란히 놓고 볼 수 있다.
 */
export function buildMonthToDateShipmentQuery(fromCompact: string, toCompact: string): string {
  return `
    SELECT
      A.MATNR,
      SUM(
        CASE
          WHEN A.VRKME = 'BOX' AND IFNULL(M.MEINS, '') <> 'BOX'
            THEN IFNULL(A.LFIMG_LIPS, 0) * IFNULL(M.UMREZ_BOX, 1)
          ELSE IFNULL(A.LFIMG_LIPS, 0)
        END
      ) AS SHIPPED_QTY,
      SUM(IFNULL(A.NETWR, 0)) AS SALES_AMOUNT
    FROM \`${DATASET}.SD_ZASSDDV0020\` AS A
    LEFT JOIN \`${DATASET}.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${fromCompact}' AND '${toCompact}'
      AND A.MATNR BETWEEN '${MATNR_FROM}' AND '${MATNR_TO}'
    GROUP BY A.MATNR
  `;
}
