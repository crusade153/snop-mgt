'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';

// 📡 실제 데이터 로딩 함수 (필수 컬럼 완벽 복구)
async function fetchRawData(sDate: string, eDate: string) {
  console.log(`🔥 [Cache Miss] BigQuery 정밀 조회 시작: ${sDate} ~ ${eDate}`);
  
  // 1. 납품(주문) 데이터: 미납 계산 및 분류를 위한 필수 컬럼
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
  
  // 2. 생산 계획: 달성률 계산용 컬럼
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

  // 3. 재고: 건전성 및 배치 분석을 위한 핵심 컬럼 (VFDAT, LGOBE 필수)
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

export async function getDashboardData(startDate: string, endDate: string) {
  if (!startDate || !endDate) return { success: false, message: "날짜 정보가 누락되었습니다." };

  const sDate = startDate.replace(/-/g, '');
  const eDate = endDate.replace(/-/g, '');

  try {
    // ✅ 캐시 키 버전 업 (v2 -> v3) : 기존 캐시 무효화 및 새로고침 강제
    const getCachedData = unstable_cache(
      async () => fetchRawData(sDate, eDate),
      [`dashboard-data-${sDate}-${eDate}-v3`], 
      { revalidate: 3600 } 
    );

    const { orders, production, inventory } = await getCachedData();

    // 데이터가 아예 없는 경우 방어 코드
    if ((!orders || orders.length === 0) && (!inventory || inventory.length === 0)) {
        console.warn("⚠️ 조회된 데이터가 없습니다.");
        // 빈 데이터라도 분석 함수를 돌려 빈 결과를 리턴해야 함 (안 그러면 클라이언트 에러)
        const emptyResult = analyzeSnopData([], [], [], startDate, endDate);
        return { success: true, data: emptyResult };
    }

    // 날짜 정보와 함께 분석 엔진 실행
    const result = analyzeSnopData(
      orders || [], 
      inventory || [], 
      production || [], 
      startDate, 
      endDate
    );
    
    return { success: true, data: result };

  } catch (error: any) {
    console.error('❌ [Server Action Error] 조회 실패:', error);
    return { success: false, message: error.message || "서버 통신 중 알 수 없는 오류가 발생했습니다." };
  }
}