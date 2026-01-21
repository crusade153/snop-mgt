'use server'

import bigqueryClient from '@/lib/bigquery';
import { runDailySimulation, SimulationParams } from '@/lib/simulation-engine';
import { format, addMonths, startOfMonth } from 'date-fns';

// 1. 제품 검색 (재고 + 주문 + 생산 통합 검색) - 단위정보 추가
export async function searchProducts(term: string) {
  // SD_MARA 조인하여 단위 및 환산계수 조회
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
    const todayStr = format(today, 'yyyyMMdd'); // 오늘 날짜 (기준)
    
    // 1. 조회 범위 설정
    // 과거 미마감 건 확인을 위해 '이번 달 1일'부터 조회 시작
    const startOfMonthStr = format(startOfMonth(today), 'yyyyMMdd');
    const futureStr = format(addMonths(today, 6), 'yyyyMMdd'); 

    // (1) 재고 배치 조회
    const stockQuery = `
      SELECT CLABS, VFDAT 
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR = '${matnr}' AND CLABS > 0
    `;

    // (2) 생산 계획 조회 (🚨 수정: LMNGA 실적 컬럼 추가 & 범위 확장)
    const prodQuery = `
      SELECT GSTRP, PSMNG, LMNGA 
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
      WHERE MATNR = '${matnr}' AND GSTRP BETWEEN '${startOfMonthStr}' AND '${futureStr}'
    `;

    // (3) 기존 주문 조회 (주문은 오늘 이후만 봐도 무방하지만, 일관성을 위해 동일 범위 적용 가능)
    // 여기서는 ATP 계산용이므로 오늘 이후 데이터만 가져옵니다.
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

    // 🚨 [핵심 로직] 생산 데이터를 'ATP용(Valid)'과 '미마감 알림용(Missed)'으로 분리
    const validProduction: any[] = [];
    const missedProduction: any[] = []; // 실적 미마감 리스트

    prodRows.forEach((row: any) => {
        const planDateStr = row.GSTRP; // YYYYMMDD
        const planQty = Number(row.PSMNG || 0);
        const actualQty = Number(row.LMNGA || 0);
        
        // 날짜 비교: 오늘보다 이전인가?
        const isPast = planDateStr < todayStr;

        if (isPast) {
            // 과거인데 실적이 0이면 -> 미마감 리스트로! (ATP 계산 제외)
            if (actualQty === 0 && planQty > 0) {
                missedProduction.push({
                    date: fmtDate(planDateStr),
                    qty: planQty
                });
            }
            // (참고: 과거인데 실적이 있으면 이미 V_MM_MCHB 재고에 포함되었으므로 여기서 무시함이 맞음)
        } else {
            // 오늘~미래 데이터 -> ATP 계산용으로 투입
            validProduction.push({ GSTRP: fmtDate(planDateStr), PSMNG: planQty });
        }
    });

    const formattedStocks = stockRows.map((r: any) => ({ ...r, VFDAT: r.VFDAT })); 
    const formattedOrders = orderRows.map((r: any) => ({ VDATU: fmtDate(r.VDATU), KWMENG: r.KWMENG }));

    // 엔진에는 'validProduction(미래)'만 넣어서 계산 (보수적 접근)
    const result = runDailySimulation(formattedStocks, validProduction, formattedOrders, params);

    // 결과에 'missedProduction'을 별도로 담아서 리턴
    return { success: true, data: { ...result, missedProduction } };

  } catch (error: any) {
    console.error("Simulation Execution Error:", error);
    return { success: false, message: error.message };
  }
}