'use server'

import bigqueryClient from '@/lib/bigquery';
import { runDailySimulation, SimulationParams } from '@/lib/simulation-engine';
import { format, addMonths, startOfMonth } from 'date-fns';

// 1. 제품 검색 (재고 + 주문 + 생산 통합 검색) - 단위정보 추가
export async function searchProducts(term: string) {
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
    const today = new Date();
    const todayStr = format(today, 'yyyyMMdd'); 
    
    const startOfMonthStr = format(startOfMonth(today), 'yyyyMMdd');
    const futureStr = format(addMonths(today, 6), 'yyyyMMdd'); 

    // (1) 재고 배치 조회 - 🚨 매출이월/이관 창고 제외
    const stockQuery = `
      SELECT CLABS, VFDAT 
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR = '${matnr}' AND CLABS > 0
        AND LGORT NOT IN ('2141', '2143', '2240', '2243')
    `;

    // (2) 생산 계획 조회
    const prodQuery = `
      SELECT 
        P.GSTRP, 
        SUM(
          CASE 
            WHEN P.MEINS = 'BOX' THEN P.PSMNG * IFNULL(M.UMREZ_BOX, 1)
            ELSE P.PSMNG 
          END
        ) as PSMNG,
        SUM(
          CASE 
            WHEN P.MEINS = 'BOX' THEN P.LMNGA * IFNULL(M.UMREZ_BOX, 1)
            ELSE P.LMNGA 
          END
        ) as LMNGA
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` AS P
      LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON P.MATNR = M.MATNR
      WHERE P.MATNR = '${matnr}' AND P.GSTRP BETWEEN '${startOfMonthStr}' AND '${futureStr}'
      GROUP BY P.GSTRP
    `;

    // (3) 기존 주문 조회 (기수요)
    const orderQuery = `
      SELECT 
        A.VDATU, 
        SUM(
          CASE 
            WHEN A.VRKME = 'BOX' THEN A.KWMENG * IFNULL(M.UMREZ_BOX, 1)
            ELSE A.KWMENG 
          END
        ) as KWMENG
      FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
      LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
      WHERE A.MATNR = '${matnr}' AND A.VDATU BETWEEN '${todayStr}' AND '${futureStr}'
      GROUP BY A.VDATU
    `;

    const [stockRows, prodRows, orderRows] = await Promise.all([
      bigqueryClient.query({ query: stockQuery }).then(r => r[0]),
      bigqueryClient.query({ query: prodQuery }).then(r => r[0]),
      bigqueryClient.query({ query: orderQuery }).then(r => r[0]),
    ]);

    const fmtDate = (d: string) => d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';

    const validProduction: any[] = [];
    const missedProduction: any[] = []; 

    prodRows.forEach((row: any) => {
        const planDateStr = row.GSTRP; 
        const planQty = Number(row.PSMNG || 0);
        const actualQty = Number(row.LMNGA || 0);
        
        const isPast = planDateStr < todayStr;

        if (isPast) {
            if (actualQty === 0 && planQty > 0) {
                missedProduction.push({
                    date: fmtDate(planDateStr),
                    qty: planQty
                });
            }
        } else {
            validProduction.push({ GSTRP: fmtDate(planDateStr), PSMNG: planQty });
        }
    });

    const formattedStocks = stockRows.map((r: any) => ({ ...r, VFDAT: r.VFDAT })); 
    const formattedOrders = orderRows.map((r: any) => ({ VDATU: fmtDate(r.VDATU), KWMENG: Number(r.KWMENG) }));

    const result = runDailySimulation(formattedStocks, validProduction, formattedOrders, params);

    return { success: true, data: { ...result, missedProduction } };

  } catch (error: any) {
    console.error("Simulation Execution Error:", error);
    return { success: false, message: error.message };
  }
}