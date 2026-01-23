'use server'

import bigqueryClient from '@/lib/bigquery';
import { generateForecast } from '@/lib/forecasting-engine';
import { subMonths, subYears, addMonths, format, parseISO, startOfMonth } from 'date-fns';

// 1. [수정] 전체 유효 품목 검색 (검색어가 없으면 전체 조회)
async function searchAllItems(term: string, endDateStr: string) {
  const endDate = new Date(endDateStr);
  const startDate = subMonths(endDate, 6); // 최근 6개월 실적 기준
  const startStr = format(startDate, 'yyyyMMdd');
  const endStr = format(endDate, 'yyyyMMdd');

  // 검색어가 있으면 필터링, 없으면 판매금액 순으로 상위 300개 (성능 고려)
  const whereCondition = term 
    ? `AND (A.MATNR LIKE '%${term}%' OR A.ARKTX LIKE '%${term}%')`
    : ``;

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
      ${whereCondition}
    GROUP BY A.MATNR, A.ARKTX
    ORDER BY total_sales_amt DESC
    LIMIT 300
  `;
  
  const [rows] = await bigqueryClient.query({ query });
  return rows;
}

// 2. [공통] 월별 이력 조회 함수
async function fetchMonthlyData(matnr: string, umrezBox: number, startQueryDate: Date, endQueryDate: Date) {
  const sDate = format(startQueryDate, 'yyyyMMdd');
  const eDate = format(endQueryDate, 'yyyyMMdd');

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
  
  // Map으로 변환 (빠른 조회용)
  const dataMap = new Map<string, number>();
  rows.forEach((r: any) => {
    // YYYYMM -> YYYY-MM-01
    const key = `${r.month_key.substring(0, 4)}-${r.month_key.substring(4, 6)}-01`;
    dataMap.set(key, Number(r.total_qty));
  });

  return dataMap;
}

// 3. [보정] 빈 달 채우기 (Gap Filling)
function fillMonthlyGaps(dataMap: Map<string, number>, startDate: Date, monthsCount: number) {
  const result = [];
  let current = startOfMonth(startDate);

  for (let i = 0; i < monthsCount; i++) {
    const key = format(current, 'yyyy-MM-dd');
    const val = dataMap.get(key) || 0; // 데이터 없으면 0 처리
    result.push({ date: key, value: val });
    current = addMonths(current, 1);
  }
  return result;
}

export async function getForecastDashboard(searchTerm?: string) {
  try {
    const today = new Date();
    
    // 1. 기간 설정
    // (A) 금년 실적: 최근 6개월 (T-6 ~ T-1)
    // (B) 전년 동월: (T-6 - 1년) ~ (T+5 - 1년) -> 총 12개월치 필요
    const historyStart = subMonths(today, 6); // 조회 시작일 (6개월 전)
    const historyEnd = today;                 // 조회 종료일 (오늘)

    // 전년도 조회 구간 (차트의 X축 전체 범위인 12개월에 해당하는 1년 전 데이터)
    const lastYearStart = subYears(historyStart, 1);
    const lastYearEnd = subYears(addMonths(today, 6), 1);

    const todayStr = format(today, 'yyyy-MM-dd');

    // ✅ [수정] 전체 검색 로직 사용
    const targetItems = await searchAllItems(searchTerm || '', todayStr);

    if (targetItems.length === 0) return { success: true, data: [] };

    const results = await Promise.all(
      targetItems.map(async (item: any) => {
        const umrez = item.UMREZ_BOX || 1;

        // DB 조회 (병렬 처리)
        const [historyMap, lastYearMap] = await Promise.all([
          fetchMonthlyData(item.MATNR, umrez, historyStart, historyEnd),
          fetchMonthlyData(item.MATNR, umrez, lastYearStart, lastYearEnd)
        ]);
        
        // 데이터 채우기 (Gap Filling)
        const historyFilled = fillMonthlyGaps(historyMap, historyStart, 6);
        const lastYearFilled = fillMonthlyGaps(lastYearMap, lastYearStart, 12);

        // 엔진 호출
        const forecast = await generateForecast(historyFilled, lastYearFilled, 6);
        
        return {
          info: { 
            id: item.MATNR, 
            name: item.ARKTX,
            unit: item.MEINS || 'EA',
            umrezBox: umrez,
            totalSales: item.total_sales_amt // 정렬용 매출액
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