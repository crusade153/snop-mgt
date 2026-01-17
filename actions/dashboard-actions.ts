'use server'

import bigqueryClient from '@/lib/bigquery';
import { analyzeSnopData } from '@/lib/analysis';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';

// 📡 실제 데이터 로딩 함수 (필수 컬럼 완벽 복구)
async function fetchRawData(sDate: string, eDate: string) {
  console.log(`🔥 [Cache Miss] BigQuery 정밀 조회 시작: ${sDate} ~ ${eDate}`);
  
  // 1. 납품(주문) 데이터: 미납 계산 및 분류를 위한 필수 컬럼 확보
  const orderQuery = `
    SELECT 
      VBELN, POSNR,           -- PK
      MATNR, ARKTX,           -- 자재 정보
      KWMENG, VRKME,          -- 주문 수량/단위
      NETWR, WAERK,           -- 금액 정보
      VDATU,                  -- 납품 요청일
      NAME1, KUNNR,           -- 거래처 정보
      -- 👇 [중요] 미납 계산용 컬럼 (없으면 0 처리)
      IFNULL(LFIMG_LIPS, 0) as LFIMG_LIPS, 
      -- 👇 [중요] 분류 분석용 (없으면 NULL)
      VKGRP, BEZEI_TVGRT      
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE VDATU BETWEEN '${sDate}' AND '${eDate}'
  `;
  
  // 2. 생산 계획: 달성률 계산용 컬럼
  const productionQuery = `
    SELECT 
      AUFNR,                  -- 오더 번호
      MATNR, MAKTX, MEINS,    -- 자재 정보
      GSTRP,                  -- 계획일
      PSMNG,                  -- 계획 수량
      LMNGA                   -- 실적 수량
    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
    WHERE GSTRP BETWEEN '${sDate}' AND '${eDate}'
  `;

  // 3. 재고: 건전성 평가를 위한 핵심 컬럼 (잔여일, 박스환산 등)
  const inventoryQuery = `
    SELECT 
      MATNR, MATNR_T, MEINS,  -- 자재 정보
      CLABS,                  -- 가용 재고
      VFDAT, HSDAT,           -- 유통기한, 제조일
      lgobe,                  -- 창고명
      -- 👇 [복구됨] 재고 건전성 로직의 핵심
      remain_day, 
      remain_rate,
      UMREZ_BOX               -- 박스 환산 계수
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
  } catch (e) {
    console.error("BigQuery Query Error:", e);
    throw e;
  }
}

export async function getDashboardData(startDate: string, endDate: string) {
  if (!startDate || !endDate) return { success: false, message: "날짜 정보가 누락되었습니다." };

  const sDate = startDate.replace(/-/g, '');
  const eDate = endDate.replace(/-/g, '');

  try {
    // 캐시 키에 날짜를 포함하여 기간별 데이터 분리 저장
    const getCachedData = unstable_cache(
      async () => fetchRawData(sDate, eDate),
      [`dashboard-data-${sDate}-${eDate}-v2`], // v2로 버전 변경하여 기존 캐시 무효화
      { revalidate: 3600 } 
    );

    const { orders, production, inventory } = await getCachedData();

    if ((!orders || orders.length === 0) && (!inventory || inventory.length === 0)) {
        return { success: false, message: "조회된 데이터가 없습니다." };
    }

    const result = analyzeSnopData(orders || [], inventory || [], production || []);
    return { success: true, data: result };

  } catch (error: any) {
    console.error('❌ [Server Action Error] 조회 실패:', error);
    return { success: false, message: error.message || "서버 오류가 발생했습니다." };
  }
}