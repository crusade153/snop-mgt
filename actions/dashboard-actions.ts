'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction, FbhInventory } from '@/types/sap';
import { unstable_cache } from 'next/cache';
import { gzipSync, gunzipSync } from 'zlib';
import { addMonths, format, subDays } from 'date-fns'; 

// 1. [내부 함수] 실제 BigQuery 조회
async function fetchRawData(sDate: string, eDate: string) {
  
  const futureEnd = format(addMonths(new Date(), 6), 'yyyyMMdd');
  // ADS 90일 계산을 위해 조회 시작일을 90일 전으로 강제 확장
  const extendedStartDate = format(subDays(new Date(), 90), 'yyyyMMdd');
  // 사용자가 요청한 날짜와 90일 전 중 더 빠른 날짜를 선택 (데이터 누락 방지)
  const queryStartDate = sDate < extendedStartDate ? sDate : extendedStartDate;

  // 1. 납품(주문) 데이터
  const orderQuery = `
    SELECT 
      A.VBELN, A.POSNR, A.MATNR, A.ARKTX, 
      A.NETWR, A.WAERK, A.VDATU, A.NAME1, A.KUNNR,
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
  `;

  // 3. 사내 플랜트 재고 (테이블 변경 적용: V_MM_MCHB -> V_MM_MCHB_ALL)
  const inventoryQuery = `
    SELECT 
      MATNR, MATNR_T, MEINS, LGOBE, VFDAT, 
      CLABS, 
      IFNULL(CINSM, 0) as CINSM, 
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX, 
      remain_day, remain_rate, 
      PRDHA_1_T, PRDHA_2_T, PRDHA_3_T
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB_ALL\`
    WHERE CLABS > 0 OR CINSM > 0 
  `;

  // 4. FBH 외부 창고 재고
  const fbhQuery = `
    SELECT 
      SKU_CD, 
      MATNR_T, 
      PRDT_DATE_NEW, 
      VALID_DATETIME_NEW, 
      AVLB_QTY, 
      MEINS, 
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX, 
      REMAINING_DAY
    FROM \`harimfood-361004.harim_sap_bi_user.V_WMV_CST_INVNLIST\`
    WHERE AVLB_QTY > 0
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

// 2. [캐싱 대상] 분석 결과 생성 및 압축
const getCompressedAnalysis = async (sDate: string, eDate: string, startDateStr: string, endDateStr: string) => {
    // 캐시 키 업데이트 (테이블 변경 반영 v4.0)
    const cacheKey = `dashboard-analysis-v4.0-${sDate}-${eDate}`;
    
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