'use server'

import bigqueryClient from '@/lib/bigquery';
import { runDailySimulation, SimulationParams } from '@/lib/simulation-engine';
import { format, addMonths } from 'date-fns';

// 1. 제품 검색 (재고 + 주문 + 생산 통합 검색)
export async function searchProducts(term: string) {
  // 사용자가 입력한 검색어가 이름(Name)이나 코드(Code)에 포함된 모든 품목을 3개 테이블에서 찾아서 합칩니다.
  const query = `
    SELECT DISTINCT MATNR, MATNR_T
    FROM (
      -- 1) 재고 테이블 (MM)
      SELECT MATNR, MATNR_T 
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR IS NOT NULL
      
      UNION ALL
      
      -- 2) 주문 테이블 (SD) - 상품명 컬럼: ARKTX
      SELECT MATNR, ARKTX as MATNR_T 
      FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
      WHERE MATNR IS NOT NULL
      
      UNION ALL
      
      -- 3) 생산 테이블 (PP) - 자재명 컬럼: MAKTX
      SELECT MATNR, MAKTX as MATNR_T 
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
      WHERE MATNR IS NOT NULL
    )
    WHERE MATNR_T LIKE '%${term}%' OR MATNR LIKE '%${term}%'
    LIMIT 20
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    return rows;
  } catch (error) {
    console.error("Search Error:", error);
    return [];
  }
}

// 2. 시뮬레이션 실행 (실제 데이터 Fetch + Engine Run)
export async function executeInventorySimulation(matnr: string, params: SimulationParams) {
  try {
    const todayStr = format(new Date(), 'yyyyMMdd');
    const futureStr = format(addMonths(new Date(), 6), 'yyyyMMdd'); // 6개월치 조회

    // (1) 재고 배치 조회 (유통기한 VFDAT 포함)
    const stockQuery = `
      SELECT CLABS, VFDAT 
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR = '${matnr}' AND CLABS > 0
    `;

    // (2) 생산 계획 조회 (일자별 GSTRP)
    const prodQuery = `
      SELECT GSTRP, PSMNG 
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
      WHERE MATNR = '${matnr}' 
        AND GSTRP BETWEEN '${todayStr}' AND '${futureStr}'
    `;

    // (3) 기존 주문 조회 (일자별 납품요청 VDATU) - 예정된 출고
    const orderQuery = `
      SELECT VDATU, KWMENG 
      FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
      WHERE MATNR = '${matnr}' 
        AND VDATU BETWEEN '${todayStr}' AND '${futureStr}'
    `;

    const [stockRows, prodRows, orderRows] = await Promise.all([
      bigqueryClient.query({ query: stockQuery }).then(r => r[0]),
      bigqueryClient.query({ query: prodQuery }).then(r => r[0]),
      bigqueryClient.query({ query: orderQuery }).then(r => r[0]),
    ]);

    // 날짜 포맷 통일 (YYYYMMDD -> YYYY-MM-DD)
    const fmtDate = (d: string) => d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';

    const formattedStocks = stockRows.map((r: any) => ({ ...r, VFDAT: r.VFDAT })); 
    const formattedProds = prodRows.map((r: any) => ({ GSTRP: fmtDate(r.GSTRP), PSMNG: r.PSMNG }));
    const formattedOrders = orderRows.map((r: any) => ({ VDATU: fmtDate(r.VDATU), KWMENG: r.KWMENG }));

    // 엔진 실행
    const result = runDailySimulation(formattedStocks, formattedProds, formattedOrders, params);

    return { success: true, data: result };

  } catch (error: any) {
    console.error("Simulation Execution Error:", error);
    return { success: false, message: error.message };
  }
}