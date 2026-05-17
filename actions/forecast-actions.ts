'use server'

import bigqueryClient from '@/lib/bigquery';
import { generateForecast } from '@/lib/forecasting-engine';
import { unstable_cache } from 'next/cache';
import { createHash } from 'crypto';
import { subMonths, subYears, addMonths, format, startOfMonth } from 'date-fns';

type ForecastTargetItem = {
  MATNR: string;
  ARKTX: string;
  MEINS?: string;
  UMREZ_BOX?: number;
  total_sales_amt?: number;
};

async function searchAllItems(term: string, endDateStr: string) {
  const endDate = new Date(endDateStr);
  const startDate = subMonths(endDate, 6);
  const startStr = format(startDate, 'yyyyMMdd');
  const endStr = format(endDate, 'yyyyMMdd');
  const safeTerm = term.trim();

  const whereCondition = safeTerm
    ? `AND (A.MATNR LIKE @term OR A.ARKTX LIKE @term)`
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
    WHERE A.VDATU BETWEEN @startStr AND @endStr
      ${whereCondition}
    GROUP BY A.MATNR, A.ARKTX
    ORDER BY total_sales_amt DESC
    LIMIT 300
  `;

  const [rows] = await bigqueryClient.query({
    query,
    params: safeTerm ? { startStr, endStr, term: `%${safeTerm}%` } : { startStr, endStr },
  });
  return rows;
}

async function fetchMonthlyDataForItems(matnrs: string[], startQueryDate: Date, endQueryDate: Date) {
  const sDate = format(startQueryDate, 'yyyyMMdd');
  const eDate = format(endQueryDate, 'yyyyMMdd');

  if (matnrs.length === 0) return new Map<string, Map<string, number>>();

  const query = `
    SELECT
      S.MATNR,
      SUBSTR(S.VDATU, 1, 6) as month_key,
      SUM(
        CASE
          WHEN S.VRKME = 'BOX' THEN S.KWMENG * IFNULL(M.UMREZ_BOX, 1)
          ELSE S.KWMENG
        END
      ) as total_qty
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS S
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON S.MATNR = M.MATNR
    WHERE S.MATNR IN UNNEST(@matnrs)
      AND S.VDATU BETWEEN @sDate AND @eDate
    GROUP BY S.MATNR, month_key
    ORDER BY S.MATNR, month_key ASC
  `;

  const [rows] = await bigqueryClient.query({
    query,
    params: { matnrs, sDate, eDate },
  });

  const byProduct = new Map<string, Map<string, number>>();
  rows.forEach((r: any) => {
    const key = `${r.month_key.substring(0, 4)}-${r.month_key.substring(4, 6)}-01`;
    const matnr = String(r.MATNR);
    if (!byProduct.has(matnr)) byProduct.set(matnr, new Map<string, number>());
    byProduct.get(matnr)!.set(key, Number(r.total_qty));
  });

  return byProduct;
}

function fillMonthlyGaps(dataMap: Map<string, number>, startDate: Date, monthsCount: number) {
  const result = [];
  let current = startOfMonth(startDate);

  for (let i = 0; i < monthsCount; i++) {
    const key = format(current, 'yyyy-MM-dd');
    const val = dataMap.get(key) || 0;
    result.push({ date: key, value: val });
    current = addMonths(current, 1);
  }
  return result;
}

function createMatnrHash(matnrs: string[]) {
  return createHash('md5')
    .update(matnrs.slice().sort().join(','))
    .digest('hex');
}

async function buildForecastDashboard(
  targetItems: ForecastTargetItem[],
  historyStart: Date,
  historyEnd: Date,
  lastYearStart: Date,
  lastYearEnd: Date
) {
  const matnrs = targetItems.map((item) => String(item.MATNR));
  const [historyByProduct, lastYearByProduct] = await Promise.all([
    fetchMonthlyDataForItems(matnrs, historyStart, historyEnd),
    fetchMonthlyDataForItems(matnrs, lastYearStart, lastYearEnd),
  ]);

  const results = await Promise.all(
    targetItems.map(async (item) => {
      const matnr = String(item.MATNR);
      const umrez = item.UMREZ_BOX || 1;
      const historyMap = historyByProduct.get(matnr) || new Map<string, number>();
      const lastYearMap = lastYearByProduct.get(matnr) || new Map<string, number>();
      const historyFilled = fillMonthlyGaps(historyMap, historyStart, 6);
      const lastYearFilled = fillMonthlyGaps(lastYearMap, lastYearStart, 12);
      const forecast = await generateForecast(historyFilled, lastYearFilled, 6);

      return {
        info: {
          id: item.MATNR,
          name: item.ARKTX,
          unit: item.MEINS || 'EA',
          umrezBox: umrez,
          totalSales: item.total_sales_amt,
        },
        ...forecast,
      };
    })
  );

  return { success: true, data: results };
}

export async function getForecastDashboard(searchTerm?: string) {
  const normalizedSearchTerm = (searchTerm || '').trim();

  try {
    const today = new Date();
    const historyStart = subMonths(today, 6);
    const historyEnd = today;
    const lastYearStart = subYears(historyStart, 1);
    const lastYearEnd = subYears(addMonths(today, 6), 1);
    const todayStr = format(today, 'yyyy-MM-dd');
    const historyStartStr = format(historyStart, 'yyyyMMdd');
    const historyEndStr = format(historyEnd, 'yyyyMMdd');
    const lastYearStartStr = format(lastYearStart, 'yyyyMMdd');
    const lastYearEndStr = format(lastYearEnd, 'yyyyMMdd');

    const targetItems = await unstable_cache(
      async () => searchAllItems(normalizedSearchTerm, todayStr),
      ['forecast-target-items-v1', normalizedSearchTerm, todayStr],
      { revalidate: 600, tags: ['report-data'] }
    )() as ForecastTargetItem[];

    if (targetItems.length === 0) return { success: true, data: [] };

    const matnrs = targetItems.map((item: any) => String(item.MATNR));
    const matnrHash = createMatnrHash(matnrs);

    return unstable_cache(
      async () => buildForecastDashboard(targetItems, historyStart, historyEnd, lastYearStart, lastYearEnd),
      [
        'forecast-dashboard-v4',
        normalizedSearchTerm,
        historyStartStr,
        historyEndStr,
        lastYearStartStr,
        lastYearEndStr,
        matnrHash,
      ],
      { revalidate: 600, tags: ['report-data'] }
    )();
  } catch (error: any) {
    console.error('Forecasting Error:', error);
    return { success: false, data: [], error: error.message };
  }
}
