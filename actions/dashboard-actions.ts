'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction, FbhInventory } from '@/types/sap';
import { getEndingInventoryPrices, resolveUnitPrice } from '@/lib/ending-inventory-price';
import { unstable_cache } from 'next/cache';
import { gzipSync, gunzipSync } from 'zlib';
import { addMonths, format, subDays } from 'date-fns'; 

async function fetchRawData(sDate: string, eDate: string) {
  
  const futureEnd = format(addMonths(new Date(), 6), 'yyyyMMdd');
  const extendedStartDate = format(subDays(new Date(), 90), 'yyyyMMdd');
  const queryStartDate = sDate < extendedStartDate ? sDate : extendedStartDate;

  // 1. 납품(주문) 데이터
  const orderQuery = `
    SELECT 
      A.VBELN, A.POSNR, A.MATNR, A.ARKTX, 
      A.NETWR, A.WAERK, A.VDATU, A.NAME1, A.KUNNR, A.WERKS, A.LGORT,
      CASE 
        WHEN A.VRKME = 'BOX' AND M.MEINS <> 'BOX' THEN A.KWMENG * IFNULL(M.UMREZ_BOX, 1)
        ELSE A.KWMENG 
      END as KWMENG,
      CASE 
        WHEN A.VRKME = 'BOX' AND M.MEINS <> 'BOX' THEN IFNULL(A.LFIMG_LIPS, 0) * IFNULL(M.UMREZ_BOX, 1)
        ELSE IFNULL(A.LFIMG_LIPS, 0)
      END as LFIMG_LIPS,
      M.MEINS, 
      IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${queryStartDate}' AND '${eDate}'
      AND A.MATNR BETWEEN '50000000' AND '69999999'
  `;
  
  // 2. 생산 계획
  const productionQuery = `
    SELECT 
      P.AUFNR, P.MATNR, P.MAKTX, P.GSTRP, P.WERKS,
      CASE 
        WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.PSMNG * IFNULL(M.UMREZ_BOX, 1)
        ELSE P.PSMNG
      END as PSMNG,
      CASE 
        WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.LMNGA * IFNULL(M.UMREZ_BOX, 1)
        ELSE P.LMNGA
      END as LMNGA,
      M.MEINS,
      IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX
    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` AS P
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON P.MATNR = M.MATNR
    WHERE P.GSTRP BETWEEN '${queryStartDate}' AND '${futureEnd}'
      AND P.MATNR BETWEEN '50000000' AND '69999999'
  `;

  // 3. 사내 플랜트 재고 
  const inventoryQuery = `
    WITH batch_master AS (
      SELECT
        MATNR,
        LGORT,
        CHARG,
        ARRAY_AGG(
          STRUCT(CAST(WERKS AS STRING) AS WERKS, DISPO)
          ORDER BY WERKS
          LIMIT 1
        )[OFFSET(0)] AS master
      FROM \`harimfood-361004.harim_sap_bi.MM_MCHB\`
      WHERE MATNR BETWEEN '50000000' AND '69999999'
      GROUP BY MATNR, LGORT, CHARG
    )
    SELECT
      I.MATNR, I.MATNR_T, I.MEINS, I.LGOBE, I.LGORT,
      B.master.WERKS AS WERKS,
      B.master.DISPO AS DISPO,
      IFNULL(SUBSTR(REPLACE(CAST(I.VFDAT AS STRING), '-', ''), 1, 8), '') AS VFDAT,
      I.CLABS,
      IFNULL(I.CINSM, 0) AS CINSM,
      IFNULL(I.UMREZ_BOX, 1) AS UMREZ_BOX,
      I.remain_day, I.remain_rate,
      I.PRDHA_1_T, I.PRDHA_2_T, I.PRDHA_3_T
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB_ALL\` AS I
    LEFT JOIN batch_master AS B
      ON I.MATNR = B.MATNR
      AND I.LGORT = B.LGORT
      AND IFNULL(I.CHARG, '') = IFNULL(B.CHARG, '')
    WHERE (I.CLABS > 0 OR I.CINSM > 0)
      AND I.LGORT NOT IN ('1110', '2141', '2143', '2240', '2243', '3000', '3300', '9000', '9100')
      AND I.MATNR BETWEEN '50000000' AND '69999999'
  `;

  // 4. FBH 외부 창고 재고
  const fbhQuery = `
    SELECT 
      SKU_CD, 
      MATNR_T, 
      IFNULL(SUBSTR(REPLACE(CAST(PRDT_DATE_NEW AS STRING), '-', ''), 1, 8), '') AS PRDT_DATE_NEW, 
      IFNULL(SUBSTR(REPLACE(CAST(VALID_DATETIME_NEW AS STRING), '-', ''), 1, 8), '') AS VALID_DATETIME_NEW, 
      AVLB_QTY, 
      MEINS, 
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX, 
      REMAINING_DAY
    FROM \`harimfood-361004.harim_sap_bi_user.V_WMV_CST_INVNLIST\`
    WHERE AVLB_QTY > 0
      AND SKU_CD BETWEEN '50000000' AND '69999999'
  `;

  try {
    const [orderRes, prodRes, invRes] = await Promise.all([
      bigqueryClient.query({ query: orderQuery }),
      bigqueryClient.query({ query: productionQuery }),
      bigqueryClient.query({ query: inventoryQuery })
    ]);

    let fbhRows: FbhInventory[] = [];
    try {
      const [fbhRes] = await bigqueryClient.query({ query: fbhQuery });
      fbhRows = fbhRes as FbhInventory[];
    } catch (fbhError) {
      console.warn("⚠️ FBH 재고 조회 실패:", fbhError);
      fbhRows = []; 
    }

    // 재고 평가금액은 SAP 표준가가 아니라 원가팀 기말재고 단가로 계산한다.
    // (표준가에는 미사용 자재의 5천만원/EA 같은 값이 남아 있어 금액이 30배 이상 튀었다)
    const prices = await getEndingInventoryPrices();
    const inventory = (invRes[0] as SapInventory[]).map((row) => {
      const { unitPrice, source } = resolveUnitPrice(prices, row.MATNR, row.WERKS);
      return {
        ...row,
        VALUATION_UNIT_PRICE: unitPrice,
        STOCK_VALUE: Number(row.CLABS || 0) * unitPrice,
        QUALITY_STOCK_VALUE: Number(row.CINSM || 0) * unitPrice,
        PRICE_SOURCE: source,
      };
    });

    // FBH 는 플랜트 정보가 없으므로 자재코드 폴백으로만 단가를 잡는다.
    const fbhInventory = fbhRows.map((row) => {
      const { unitPrice, source } = resolveUnitPrice(prices, row.SKU_CD);
      return {
        ...row,
        VALUATION_UNIT_PRICE: unitPrice,
        STOCK_VALUE: Number(row.AVLB_QTY || 0) * unitPrice,
        PRICE_SOURCE: source,
      };
    });

    return {
      orders: orderRes[0] as SapOrder[],
      production: prodRes[0] as SapProduction[],
      inventory,
      fbhInventory,
      priceAsOfLabel: prices.asOfLabel,
    };
  } catch (e: any) {
    console.error("🚨 BigQuery Critical Error:", e.message);
    throw new Error(`데이터베이스 조회 실패: ${e.message}`);
  }
}

const getCompressedAnalysis = async (sDate: string, eDate: string, startDateStr: string, endDateStr: string) => {
    // 단가 소스를 기말재고(ending_inventory)로 교체하면서 캐시 버전을 상향합니다.
    const cacheKey = `dashboard-analysis-v7-${sDate}-${eDate}`;

    return await unstable_cache(
      async () => {
        const { orders, production, inventory, fbhInventory, priceAsOfLabel } = await fetchRawData(sDate, eDate);

        if ((!orders || orders.length === 0) && (!inventory || inventory.length === 0) && (!fbhInventory || fbhInventory.length === 0)) {
            const emptyData = analyzeSnopData([], [], [], [], startDateStr, endDateStr);
            return gzipSync(JSON.stringify({ success: true, data: emptyData })).toString('base64');
        }

        const analyzedData = analyzeSnopData(
          orders || [],
          inventory || [],
          production || [],
          fbhInventory || [],
          startDateStr,
          endDateStr,
          priceAsOfLabel
        );

        const compressed = gzipSync(JSON.stringify({ success: true, data: analyzedData })).toString('base64');
        return compressed;
      },
      [cacheKey], 
      { revalidate: 600, tags: ['report-data'] } 
    )();
};

/**
 * 최근 14일 일별 매출을 조회하여 KPI 트렌드 데이터 반환
 * (현재 7일 vs 이전 7일 비교)
 */
export async function getKpiTrend() {
  return unstable_cache(
    getKpiTrendUncached,
    ['kpi-trend-v1'],
    { revalidate: 600, tags: ['report-data'] }
  )();
}

async function getKpiTrendUncached() {
  const today = new Date();
  const start14 = format(subDays(today, 13), 'yyyyMMdd');
  const todayStr = format(today, 'yyyyMMdd');

  const query = `
    SELECT
      A.VDATU as date,
      SUM(A.NETWR) as amount
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
    WHERE A.VDATU BETWEEN '${start14}' AND '${todayStr}'
      AND A.MATNR BETWEEN '50000000' AND '69999999'
    GROUP BY A.VDATU
    ORDER BY A.VDATU ASC
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    const daily: { date: string; amount: number }[] = (rows as any[]).map((r) => ({
      date: String(r.date || ''),
      amount: Number(r.amount) || 0,
    }));

    // 현재 7일 / 이전 7일 분리
    const today7 = format(subDays(today, 6), 'yyyyMMdd');
    const current7 = daily.filter((r) => r.date >= today7);
    const prev7 = daily.filter((r) => r.date < today7);

    const currentTotal = current7.reduce((s, r) => s + r.amount, 0);
    const prevTotal = prev7.reduce((s, r) => s + r.amount, 0);
    const changeRate = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;

    return {
      success: true,
      data: {
        sparkline: daily.map((r) => r.amount), // 14개 포인트
        currentWeekTotal: currentTotal,
        prevWeekTotal: prevTotal,
        changeRate: Math.round(changeRate * 10) / 10,
      },
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * 청구(매출) 기준 매출 조회 — V_SD_SO1 (FKDAT 청구일 기준)
 * 대시보드 "납품 매출"(SD_ZASSDDV0020, VDATU 납품요청일 기준)과 병행 표시하기 위한 지표.
 * 사용자가 대조하는 V_SD_SO1 값과 정확히 일치시키기 위해 raw SUM(NETWR)을 그대로 합산한다.
 */
export async function getBillingRevenue(startDate: string, endDate: string) {
  if (!startDate || !endDate) return { success: false, message: "날짜 정보가 누락되었습니다." };

  const s = startDate.replace(/-/g, '');
  const e = endDate.replace(/-/g, '');

  return unstable_cache(
    async () => getBillingRevenueUncached(s, e),
    [`billing-revenue-v1-${s}-${e}`],
    { revalidate: 600, tags: ['report-data'] }
  )();
}

async function getBillingRevenueUncached(s: string, e: string) {
  const query = `
    SELECT VTWEG, ROUND(SUM(NETWR)) AS netwr
    FROM \`harimfood-361004.harim_sap_bi_user.V_SD_SO1\`
    WHERE FKDAT BETWEEN '${s}' AND '${e}'
      AND MATNR BETWEEN '50000000' AND '69999999'
    GROUP BY VTWEG
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    let domestic = 0; // VTWEG '10' 내수
    let exportSales = 0; // VTWEG '20' 수출
    let total = 0;
    (rows as any[]).forEach((r) => {
      const amt = Number(r.netwr) || 0;
      total += amt;
      if (String(r.VTWEG) === '10') domestic += amt;
      else if (String(r.VTWEG) === '20') exportSales += amt;
    });
    return { success: true, data: { total, domestic, export: exportSales } };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function getDashboardData(startDate: string, endDate: string) {
  if (!startDate || !endDate) return { success: false, message: "날짜 정보가 누락되었습니다." };

  const sDate = startDate.replace(/-/g, '');
  const eDate = endDate.replace(/-/g, '');

  try {
    const compressedData = await getCompressedAnalysis(sDate, eDate, startDate, endDate);
    const decompressedBuffer = gunzipSync(Buffer.from(compressedData, 'base64'));
    const result = JSON.parse(decompressedBuffer.toString('utf-8'));
    return result;
  } catch (error: any) {
    console.error('❌ [Server Action Error]:', error);
    return { success: false, message: error.message };
  }
}
