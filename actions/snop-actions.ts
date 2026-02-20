'use server'

import bigqueryClient from '@/lib/bigquery';
import { aggregateData } from '@/lib/snop-aggregation';
import { SapOrder, SapProduction } from '@/types/sap';
import { addDays, addWeeks, format, startOfWeek, endOfWeek, getISOWeek, parseISO, eachDayOfInterval, eachWeekOfInterval } from 'date-fns';

interface SnopOption {
  mode: 'WEEK' | 'DAY';
  weekCount?: number;   
  startDate?: string;   
  endDate?: string;     
}

export async function getSnopPlan(matnr: string, option: SnopOption) {
  const today = new Date();
  
  let start: Date, end: Date;
  
  if (option.mode === 'WEEK') {
    start = startOfWeek(today, { weekStartsOn: 1 });
    end = endOfWeek(addWeeks(today, (option.weekCount || 4) - 1), { weekStartsOn: 1 });
  } else {
    start = option.startDate ? parseISO(option.startDate) : today;
    end = option.endDate ? parseISO(option.endDate) : addDays(today, 6); 
  }

  const dbStart = format(start, 'yyyyMMdd');
  const dbEnd = format(end, 'yyyyMMdd');

  try {
    // 🚨 재고 쿼리 창고 필터 적용
    const stockQuery = `
      SELECT SUM(CLABS) as total 
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\` 
      WHERE MATNR = '${matnr}'
        AND LGORT NOT IN ('2141', '2143', '2240', '2243')
    `;
    const orderQuery = `SELECT * FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` WHERE MATNR = '${matnr}' AND VDATU BETWEEN '${dbStart}' AND '${dbEnd}'`;
    const prodQuery = `SELECT * FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` WHERE MATNR = '${matnr}' AND GSTRP BETWEEN '${dbStart}' AND '${dbEnd}'`;

    const [stockRows, orderRows, prodRows] = await Promise.all([
      bigqueryClient.query({ query: stockQuery }).then(r => r[0]),
      bigqueryClient.query({ query: orderQuery }).then(r => r[0]),
      bigqueryClient.query({ query: prodQuery }).then(r => r[0]),
    ]);

    const aggregatedMap = aggregateData(orderRows as SapOrder[], prodRows as SapProduction[], option.mode);

    const resultList = [];
    
    if (option.mode === 'WEEK') {
      const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
      for (const w of weeks) {
        const key = `W${getISOWeek(w)}`;
        const found = aggregatedMap.get(key);
        resultList.push(found || { dateKey: key, periodLabel: key, demand: 0, supply: 0 });
      }
    } else {
      const days = eachDayOfInterval({ start, end });
      for (const d of days) {
        const key = format(d, 'yyyyMMdd');
        const found = aggregatedMap.get(key);
        resultList.push(found || { dateKey: key, periodLabel: format(d, 'MM-dd'), demand: 0, supply: 0 });
      }
    }

    return {
      success: true,
      data: {
        matnr,
        currentStock: stockRows[0]?.total || 0,
        planData: resultList
      }
    };

  } catch (error: any) {
    console.error("S&OP Load Error:", error);
    return { success: false, message: error.message };
  }
}