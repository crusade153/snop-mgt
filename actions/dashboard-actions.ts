'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';
import { gzipSync, gunzipSync } from 'zlib'; // 🗜️ 압축 라이브러리 추가

// 1. [내부 함수] 실제 BigQuery 조회
async function fetchRawData(sDate: string, eDate: string) {
  // 1. 납품(주문) 데이터
  const orderQuery = `
    SELECT 
      VBELN, POSNR,           
      MATNR, ARKTX,           
      KWMENG, VRKME,          
      NETWR, WAERK,           
      VDATU,                  
      NAME1, KUNNR,           
      IFNULL(LFIMG_LIPS, 0) as LFIMG_LIPS, 
      VKGRP, BEZEI_TVGRT      
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE VDATU BETWEEN '${sDate}' AND '${eDate}'
  `;
  
  // 2. 생산 계획
  const productionQuery = `
    SELECT 
      AUFNR,                  
      MATNR, MAKTX, MEINS,    
      GSTRP,                  
      PSMNG,                  
      LMNGA                   
    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
    WHERE GSTRP BETWEEN '${sDate}' AND '${eDate}'
  `;

  // 3. 재고 (전체 유효 재고)
  const inventoryQuery = `
    SELECT 
      MATNR, MATNR_T, MEINS,  
      CLABS,                  
      VFDAT, HSDAT,           
      LGOBE,                  
      remain_day, 
      remain_rate,
      UMREZ_BOX               
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

// 2. [캐싱 대상] 분석 결과 생성 및 "압축(Compression)" 🗜️
// Next.js 캐시 제한(2MB)을 우회하기 위해 압축된 문자열(Base64)을 반환합니다.
const getCompressedAnalysis = unstable_cache(
  async (sDate: string, eDate: string, startDateStr: string, endDateStr: string) => {
    
    // 1) 데이터 가져오기
    const { orders, production, inventory } = await fetchRawData(sDate, eDate);

    // 2) 데이터가 없는 경우 처리
    if ((!orders || orders.length === 0) && (!inventory || inventory.length === 0)) {
        const emptyData = analyzeSnopData([], [], [], startDateStr, endDateStr);
        // 빈 데이터도 압축해서 리턴
        return gzipSync(JSON.stringify({ success: true, data: emptyData })).toString('base64');
    }

    // 3) 분석 엔진 실행
    const analyzedData = analyzeSnopData(
      orders || [], 
      inventory || [], 
      production || [], 
      startDateStr, 
      endDateStr
    );

    const resultObj = { success: true, data: analyzedData };

    // 4) 🗜️ 결과 객체를 JSON 문자열로 변환 후 Gzip 압축 -> Base64 문자열로 변환
    // 이렇게 하면 2.8MB -> 약 0.3MB로 줄어듭니다.
    const compressed = gzipSync(JSON.stringify(resultObj)).toString('base64');
    
    return compressed;
  },
  ['dashboard-analysis-v5-compressed'], // Cache Key (버전 변경 v4 -> v5)
  { revalidate: 3600 } 
);

// 3. [메인 액션] 외부 호출 함수 (압축 해제 담당)
export async function getDashboardData(startDate: string, endDate: string) {
  if (!startDate || !endDate) return { success: false, message: "날짜 정보가 누락되었습니다." };

  const sDate = startDate.replace(/-/g, '');
  const eDate = endDate.replace(/-/g, '');

  try {
    // console.log(`⚡ [Action] 데이터 요청 (Compressed Cache): ${startDate} ~ ${endDate}`);
    
    // 1) 캐시된 "압축 데이터" 가져오기
    const compressedData = await getCompressedAnalysis(sDate, eDate, startDate, endDate);
    
    // 2) 🔓 압축 해제 (Decompress)
    // Base64 -> Buffer -> Gunzip -> JSON Parse
    const decompressedBuffer = gunzipSync(Buffer.from(compressedData, 'base64'));
    const result = JSON.parse(decompressedBuffer.toString('utf-8'));
    
    return result;

  } catch (error: any) {
    console.error('❌ [Server Action Error] 조회 실패:', error);
    return { success: false, message: error.message || "서버 통신 중 알 수 없는 오류가 발생했습니다." };
  }
}