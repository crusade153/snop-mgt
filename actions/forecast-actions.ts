'use server'

import bigqueryClient from '@/lib/bigquery';
import { generateForecast } from '@/lib/forecasting-engine';
import { subMonths, format } from 'date-fns';

// 1. 매출액(NETWR) 기준 상위 10개 조회 (최근 3개월)
async function getTopSalesItemsByAmount(endDateStr: string) {
  const endDate = new Date(endDateStr);
  const startDate = subMonths(endDate, 3);
  
  const startStr = format(startDate, 'yyyyMMdd');
  const endStr = format(endDate, 'yyyyMMdd');

  const query = `
    SELECT MATNR, ARKTX, SUM(NETWR) as total_sales_amt
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE VDATU BETWEEN '${startStr}' AND '${endStr}'
    GROUP BY MATNR, ARKTX
    ORDER BY total_sales_amt DESC
    LIMIT 10
  `;
  
  const [rows] = await bigqueryClient.query({ query });
  return rows;
}

// 2. 전체 품목 검색 (매출 0이어도 나와야 함!)
async function searchAllItems(term: string, endDateStr: string) {
  // 검색 범위는 좀 더 넓게 잡아서(1년) 재고는 있는데 최근 안 팔린 것도 나오게 함
  const endDate = new Date(endDateStr);
  const startDate = subMonths(endDate, 12); 
  const startStr = format(startDate, 'yyyyMMdd');
  const endStr = format(endDate, 'yyyyMMdd');

  const query = `
    SELECT MATNR, ARKTX, SUM(NETWR) as total_sales_amt
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE VDATU BETWEEN '${startStr}' AND '${endStr}'
      AND (MATNR LIKE '%${term}%' OR ARKTX LIKE '%${term}%')
    GROUP BY MATNR, ARKTX
    -- HAVING 조건 제거: 매출 0인 것도 조회됨
    ORDER BY total_sales_amt DESC
    LIMIT 10
  `;
  const [rows] = await bigqueryClient.query({ query });
  return rows;
}

// 3. 월별 이력 조회 (최근 6개월 - 차트 표현용, 계산은 3개월만 씀)
async function getItemHistory(matnr: string) {
  const today = new Date();
  const startQueryDate = subMonths(today, 6);
  const sDate = format(startQueryDate, 'yyyyMMdd');
  const eDate = format(today, 'yyyyMMdd');

  const query = `
    SELECT 
      SUBSTR(VDATU, 1, 6) as month_key, 
      SUM(KWMENG) as total_qty
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE MATNR = '${matnr}'
      AND VDATU BETWEEN '${sDate}' AND '${eDate}'
    GROUP BY month_key
    ORDER BY month_key ASC
  `;
  const [rows] = await bigqueryClient.query({ query });
  
  // 데이터가 없는 달도 0으로 채워줘야 차트가 끊기지 않음 (간이 처리)
  return rows.map((r: any) => ({
    date: `${r.month_key.substring(0, 4)}-${r.month_key.substring(4, 6)}-01`,
    value: Number(r.total_qty)
  }));
}

// 메인 액션
export async function getForecastDashboard(searchTerm?: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    
    let targetItems = [];
    if (searchTerm) {
      targetItems = await searchAllItems(searchTerm, today);
    } else {
      targetItems = await getTopSalesItemsByAmount(today);
    }

    if (targetItems.length === 0) return { success: true, data: [] };

    const results = await Promise.all(
      targetItems.map(async (item: any) => {
        const history = await getItemHistory(item.MATNR);
        
        // 이력이 아예 없으면 0으로 채워서라도 보여줌 (검색은 되었으니)
        const safeHistory = history.length > 0 ? history : [{ date: today, value: 0 }];

        const forecast = await generateForecast(safeHistory, 6);
        return {
          info: { id: item.MATNR, name: item.ARKTX },
          ...forecast
        };
      })
    );

    return { success: true, data: results };

  } catch (error: any) {
    console.error("Forecasting Error:", error);
    return { success: false, error: error.message };
  }
}