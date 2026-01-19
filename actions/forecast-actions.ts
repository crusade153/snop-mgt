'use server'

import bigqueryClient from '@/lib/bigquery';
import { generateForecast } from '@/lib/forecasting-engine';
import { subMonths, format } from 'date-fns';

// 1. 매출액 기준 상위 10개 조회 (단위정보 포함)
async function getTopSalesItemsByAmount(endDateStr: string) {
  const endDate = new Date(endDateStr);
  const startDate = subMonths(endDate, 3);
  
  const startStr = format(startDate, 'yyyyMMdd');
  const endStr = format(endDate, 'yyyyMMdd');

  // 🚨 [수정] SD_MARA 조인하여 단위 및 환산계수 조회
  const query = `
    SELECT 
      A.MATNR, 
      A.ARKTX, 
      SUM(A.NETWR) as total_sales_amt,
      MAX(M.MEINS) as MEINS,
      MAX(IFNULL(M.UMREZ_BOX, 1)) as UMREZ_BOX
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${startStr}' AND '${endStr}'
    GROUP BY A.MATNR, A.ARKTX
    ORDER BY total_sales_amt DESC
    LIMIT 10
  `;
  
  const [rows] = await bigqueryClient.query({ query });
  return rows;
}

// 2. 전체 품목 검색 (단위정보 포함)
async function searchAllItems(term: string, endDateStr: string) {
  const endDate = new Date(endDateStr);
  const startDate = subMonths(endDate, 12); 
  const startStr = format(startDate, 'yyyyMMdd');
  const endStr = format(endDate, 'yyyyMMdd');

  const query = `
    SELECT 
      A.MATNR, 
      A.ARKTX, 
      SUM(A.NETWR) as total_sales_amt,
      MAX(M.MEINS) as MEINS,
      MAX(IFNULL(M.UMREZ_BOX, 1)) as UMREZ_BOX
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${startStr}' AND '${endStr}'
      AND (A.MATNR LIKE '%${term}%' OR A.ARKTX LIKE '%${term}%')
    GROUP BY A.MATNR, A.ARKTX
    ORDER BY total_sales_amt DESC
    LIMIT 10
  `;
  const [rows] = await bigqueryClient.query({ query });
  return rows;
}

// 3. 월별 이력 조회 (환산 로직 추가)
async function getItemHistory(matnr: string, umrezBox: number) {
  const today = new Date();
  const startQueryDate = subMonths(today, 6);
  const sDate = format(startQueryDate, 'yyyyMMdd');
  const eDate = format(today, 'yyyyMMdd');

  // 🚨 [수정] 박스 단위로 기록된 판매량은 기준 단위로 환산하여 집계
  const query = `
    SELECT 
      SUBSTR(VDATU, 1, 6) as month_key, 
      SUM(
        CASE 
          WHEN VRKME = 'BOX' THEN KWMENG * ${umrezBox}
          ELSE KWMENG 
        END
      ) as total_qty
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    WHERE MATNR = '${matnr}'
      AND VDATU BETWEEN '${sDate}' AND '${eDate}'
    GROUP BY month_key
    ORDER BY month_key ASC
  `;
  const [rows] = await bigqueryClient.query({ query });
  
  return rows.map((r: any) => ({
    date: `${r.month_key.substring(0, 4)}-${r.month_key.substring(4, 6)}-01`,
    value: Number(r.total_qty)
  }));
}

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
        // 단위 정보 전달
        const history = await getItemHistory(item.MATNR, item.UMREZ_BOX || 1);
        
        const safeHistory = history.length > 0 ? history : [{ date: today, value: 0 }];
        const forecast = await generateForecast(safeHistory, 6);
        
        return {
          info: { 
            id: item.MATNR, 
            name: item.ARKTX,
            unit: item.MEINS || 'EA',
            umrezBox: item.UMREZ_BOX || 1
          },
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