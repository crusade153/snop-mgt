'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';
import { gzipSync, gunzipSync } from 'zlib';
import { addMonths, format } from 'date-fns'; // ✅ 날짜 라이브러리 추가

// 1. [내부 함수] 실제 BigQuery 조회
async function fetchRawData(sDate: string, eDate: string) {
  
  // ✅ [핵심] 생산 계획은 '미래' 데이터가 필요하므로 종료일을 6개월 뒤로 확장
  const futureEnd = format(addMonths(new Date(), 6), 'yyyyMMdd');

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
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M 
      ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${sDate}' AND '${eDate}' -- 주문은 선택 기간만 조회
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
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M
      ON P.MATNR = M.MATNR
    WHERE P.GSTRP BETWEEN '${sDate}' AND '${futureEnd}' -- ✅ [수정] 미래 계획까지 조회
  `;

  // 3. 재고
  const inventoryQuery = `
    SELECT 
      MATNR, MATNR_T, MEINS, LGOBE, VFDAT, 
      CLABS, 
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX, 
      remain_day, remain_rate, 
      PRDHA_1_T, PRDHA_2_T, PRDHA_3_T
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
    WHERE CLABS > 0
  `;

  try {
    const [orderRes, prodRes, invRes] = await Promise.all([
      bigqueryClient.query({ query: orderQuery }),
      bigqueryClient.query({ query: productionQuery }),
      bigqueryClient.query({ query: inventoryQuery })
    ]);

    return {
      orders: orderRes[0] as SapOrder[],
      production: prodRes[0] as SapProduction[],
      inventory: invRes[0] as SapInventory[]
    };
  } catch (e: any) {
    console.error("🚨 BigQuery Query Error:", e.message);
    throw new Error(`데이터베이스 조회 실패: ${e.message}`);
  }
}

// 2. [캐싱 대상] 분석 결과 생성 및 압축
const getCompressedAnalysis = async (sDate: string, eDate: string, startDateStr: string, endDateStr: string) => {
    // 캐시 키 업데이트 (v12 - 미래계획 반영)
    const cacheKey = `dashboard-analysis-v12-${sDate}-${eDate}`;
    
    return await unstable_cache(
      async () => {
        const { orders, production, inventory } = await fetchRawData(sDate, eDate);

        if ((!orders || orders.length === 0) && (!inventory || inventory.length === 0)) {
            const emptyData = analyzeSnopData([], [], [], startDateStr, endDateStr);
            return gzipSync(JSON.stringify({ success: true, data: emptyData })).toString('base64');
        }

        const analyzedData = analyzeSnopData(
          orders || [], 
          inventory || [], 
          production || [], 
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

// 3. [메인 액션] 외부 호출 함수
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