'use server'

import bigqueryClient from '@/lib/bigquery';
import { runDailySimulation, SimulationParams } from '@/lib/simulation-engine';
import { format, addMonths } from 'date-fns';

// 1. 제품 검색 (재고 + 주문 + 생산 통합 검색) - 단위정보 추가
export async function searchProducts(term: string) {
  // 🚨 [수정] SD_MARA 조인하여 단위 및 환산계수 조회
  const query = `
    SELECT DISTINCT A.MATNR, A.MATNR_T, M.MEINS, IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX
    FROM (
      SELECT MATNR, MATNR_T FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\` WHERE MATNR IS NOT NULL
      UNION ALL
      SELECT MATNR, ARKTX as MATNR_T FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` WHERE MATNR IS NOT NULL
      UNION ALL
      SELECT MATNR, MAKTX as MATNR_T FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` WHERE MATNR IS NOT NULL
    ) A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.MATNR_T LIKE '%${term}%' OR A.MATNR LIKE '%${term}%'
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
    const futureStr = format(addMonths(new Date(), 6), 'yyyyMMdd'); 

    // (1) 재고 배치 조회
    const stockQuery = `
      SELECT CLABS, VFDAT 
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR = '${matnr}' AND CLABS > 0
    `;

    // (2) 생산 계획 조회
    const prodQuery = `
      SELECT GSTRP, PSMNG 
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
      WHERE MATNR = '${matnr}' AND GSTRP BETWEEN '${todayStr}' AND '${futureStr}'
    `;

    // (3) 기존 주문 조회
    const orderQuery = `
      SELECT VDATU, KWMENG 
      FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
      WHERE MATNR = '${matnr}' AND VDATU BETWEEN '${todayStr}' AND '${futureStr}'
    `;

    const [stockRows, prodRows, orderRows] = await Promise.all([
      bigqueryClient.query({ query: stockQuery }).then(r => r[0]),
      bigqueryClient.query({ query: prodQuery }).then(r => r[0]),
      bigqueryClient.query({ query: orderQuery }).then(r => r[0]),
    ]);

    const fmtDate = (d: string) => d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';

    const formattedStocks = stockRows.map((r: any) => ({ ...r, VFDAT: r.VFDAT })); 
    const formattedProds = prodRows.map((r: any) => ({ GSTRP: fmtDate(r.GSTRP), PSMNG: r.PSMNG }));
    const formattedOrders = orderRows.map((r: any) => ({ VDATU: fmtDate(r.VDATU), KWMENG: r.KWMENG }));

    const result = runDailySimulation(formattedStocks, formattedProds, formattedOrders, params);

    return { success: true, data: result };

  } catch (error: any) {
    console.error("Simulation Execution Error:", error);
    return { success: false, message: error.message };
  }
}