'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';
import { gzipSync, gunzipSync } from 'zlib';

// 1. [내부 함수] 실제 BigQuery 조회
async function fetchRawData(sDate: string, eDate: string) {
  // 1. 납품(주문) 데이터 - SD_MARA 조인하여 단위 환산
  // 🚨 수정사항: MD_MARA -> SD_MARA 로 테이블명 변경
  const orderQuery = `
    SELECT 
      A.VBELN, A.POSNR, A.MATNR, A.ARKTX, 
      A.NETWR, A.WAERK, A.VDATU, A.NAME1, A.KUNNR,
      
      -- [핵심] 주문수량(KWMENG) 환산: 단위가 BOX면 곱하기, 아니면 그대로
      CASE 
        WHEN A.VRKME = 'BOX' AND M.MEINS <> 'BOX' THEN A.KWMENG * IFNULL(M.UMREZ_BOX, 1)
        ELSE A.KWMENG 
      END as KWMENG,

      -- [핵심] 실납품수량(LFIMG) 환산
      CASE 
        WHEN A.VRKME = 'BOX' AND M.MEINS <> 'BOX' THEN IFNULL(A.LFIMG_LIPS, 0) * IFNULL(M.UMREZ_BOX, 1)
        ELSE IFNULL(A.LFIMG_LIPS, 0)
      END as LFIMG_LIPS,

      -- [핵심] 기준 단위와 환산 계수 가져오기
      M.MEINS, 
      IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX

    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
    -- 🚨 테이블명 수정됨 (MD_MARA -> SD_MARA)
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M 
      ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${sDate}' AND '${eDate}'
  `;
  
  // 2. 생산 계획 - SD_MARA 조인하여 단위 환산
  // 🚨 수정사항: MD_MARA -> SD_MARA 로 테이블명 변경
  const productionQuery = `
    SELECT 
      P.AUFNR, P.MATNR, P.MAKTX, P.GSTRP, P.WERKS,
      
      -- [핵심] 생산계획(PSMNG) 환산
      CASE 
        WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.PSMNG * IFNULL(M.UMREZ_BOX, 1)
        ELSE P.PSMNG
      END as PSMNG,

      -- [핵심] 생산실적(LMNGA) 환산
      CASE 
        WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.LMNGA * IFNULL(M.UMREZ_BOX, 1)
        ELSE P.LMNGA
      END as LMNGA,

      M.MEINS,
      IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX

    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` AS P
    -- 🚨 테이블명 수정됨 (MD_MARA -> SD_MARA)
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M
      ON P.MATNR = M.MATNR
    WHERE P.GSTRP BETWEEN '${sDate}' AND '${eDate}'
  `;

  // 3. 재고 (이미 V_MM_MCHB 뷰 안에 UMREZ_BOX가 있으므로 조인 불필요)
  const inventoryQuery = `
    SELECT 
      MATNR, MATNR_T, MEINS, LGOBE, VFDAT, 
      CLABS, -- 재고는 이미 기본 단위로 관리됨
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX, -- 환산 계수
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
    // 캐시 키 버전 업데이트 (v11 - 테이블명 수정 반영)
    const cacheKey = `dashboard-analysis-v11-${sDate}-${eDate}`;
    
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