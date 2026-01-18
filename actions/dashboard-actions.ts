'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';
import { gzipSync, gunzipSync } from 'zlib';

// 1. [내부 함수] 실제 BigQuery 조회
async function fetchRawData(sDate: string, eDate: string) {
  // 1. 납품(주문) 데이터
  const orderQuery = `
    SELECT 
      VBELN, POSNR, MATNR, ARKTX, KWMENG, VRKME, NETWR, WAERK, VDATU, NAME1, KUNNR, 
      IFNULL(LFIMG_LIPS, 0) as LFIMG_LIPS, VKGRP, BEZEI_TVGRT      
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE VDATU BETWEEN '${sDate}' AND '${eDate}'
  `;
  
  // 2. 생산 계획 (🚨 WERKS 추가됨)
  const productionQuery = `
    SELECT 
      AUFNR, MATNR, MAKTX, MEINS, GSTRP,
      WERKS, -- ✅ 플랜트 정보 추가
      PSMNG, LMNGA                   
    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
    WHERE GSTRP BETWEEN '${sDate}' AND '${eDate}'
  `;

  // 3. 재고 (전체 유효 재고)
  const inventoryQuery = `
    SELECT MATNR, MATNR_T, MEINS, CLABS, VFDAT, HSDAT, LGOBE, remain_day, remain_rate, UMREZ_BOX               
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
    // 🚨 버전 v9로 변경 (WERKS 추가 반영)
    const cacheKey = `dashboard-analysis-v9-${sDate}-${eDate}`;
    
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