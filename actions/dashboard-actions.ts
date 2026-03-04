'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction, FbhInventory } from '@/types/sap';
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
    SELECT 
      MATNR, MATNR_T, MEINS, LGOBE, LGORT,
      IFNULL(SUBSTR(REPLACE(CAST(VFDAT AS STRING), '-', ''), 1, 8), '') AS VFDAT,
      CLABS, 
      IFNULL(CINSM, 0) as CINSM, 
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX, 
      remain_day, remain_rate, 
      PRDHA_1_T, PRDHA_2_T, PRDHA_3_T
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB_ALL\`
    WHERE (CLABS > 0 OR CINSM > 0)
      AND LGORT NOT IN ('1110', '2141', '2143', '2240', '2243', '3000', '3300', '9000', '9100')
      AND MATNR BETWEEN '50000000' AND '69999999'
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

    return {
      orders: orderRes[0] as SapOrder[],
      production: prodRes[0] as SapProduction[],
      inventory: invRes[0] as SapInventory[],
      fbhInventory: fbhRows
    };
  } catch (e: any) {
    console.error("🚨 BigQuery Critical Error:", e.message);
    throw new Error(`데이터베이스 조회 실패: ${e.message}`);
  }
}

const getCompressedAnalysis = async (sDate: string, eDate: string, startDateStr: string, endDateStr: string) => {
    // 🚨 캐시 무효화를 위해 버전 v5.5로 상향
    const cacheKey = `dashboard-analysis-v5.5-${sDate}-${eDate}`;
    
    return await unstable_cache(
      async () => {
        const { orders, production, inventory, fbhInventory } = await fetchRawData(sDate, eDate);

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
          endDateStr
        );

        const compressed = gzipSync(JSON.stringify({ success: true, data: analyzedData })).toString('base64');
        return compressed;
      },
      [cacheKey], 
      { revalidate: 60 } 
    )();
};

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