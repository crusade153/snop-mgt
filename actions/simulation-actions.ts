'use server'

import bigqueryClient from '@/lib/bigquery';
import { runDailySimulation, SimulationParams } from '@/lib/simulation-engine';
import { unstable_cache } from 'next/cache';
import { format, addMonths, startOfMonth } from 'date-fns';

export async function searchProducts(term: string) {
  const safeTerm = term.trim();
  const query = `
    SELECT DISTINCT A.MATNR, A.MATNR_T, M.MEINS, IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX
    FROM (
      SELECT MATNR, MATNR_T FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR IS NOT NULL AND MATNR BETWEEN '50000000' AND '69999999'
      UNION ALL
      SELECT MATNR, ARKTX as MATNR_T FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
      WHERE MATNR IS NOT NULL AND MATNR BETWEEN '50000000' AND '69999999'
      UNION ALL
      SELECT MATNR, MAKTX as MATNR_T FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
      WHERE MATNR IS NOT NULL AND MATNR BETWEEN '50000000' AND '69999999'
    ) A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.MATNR_T LIKE @term OR A.MATNR LIKE @term
    LIMIT 20
  `;

  try {
    return unstable_cache(
      async () => {
        const [rows] = await bigqueryClient.query({
          query,
          params: { term: `%${safeTerm}%` },
        });
        return rows;
      },
      ['simulation-search-products-v1', safeTerm],
      { revalidate: 600, tags: ['report-data'] }
    )();
  } catch (error) {
    console.error('Search Error:', error);
    return [];
  }
}

async function executeInventorySimulationUncached(matnr: string, params: SimulationParams) {
  try {
    const today = new Date();
    const todayStr = format(today, 'yyyyMMdd');
    const startOfMonthStr = format(startOfMonth(today), 'yyyyMMdd');
    const futureStr = format(addMonths(today, 6), 'yyyyMMdd');

    const stockQuery = `
      SELECT CLABS, VFDAT
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE MATNR = @matnr AND CLABS > 0
        AND LGORT NOT IN ('2141', '2143', '2240', '2243')
    `;

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
      WHERE P.MATNR = @matnr AND P.GSTRP BETWEEN @startOfMonthStr AND @futureStr
      GROUP BY P.GSTRP
    `;

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
      WHERE A.MATNR = @matnr AND A.VDATU BETWEEN @todayStr AND @futureStr
      GROUP BY A.VDATU
    `;

    const queryParams = { matnr, startOfMonthStr, todayStr, futureStr };
    const [stockRows, prodRows, orderRows] = await Promise.all([
      bigqueryClient.query({ query: stockQuery, params: queryParams }).then(r => r[0]),
      bigqueryClient.query({ query: prodQuery, params: queryParams }).then(r => r[0]),
      bigqueryClient.query({ query: orderQuery, params: queryParams }).then(r => r[0]),
    ]);

    const fmtDate = (d: string) => d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
    const validProduction: any[] = [];
    const missedProduction: any[] = [];

    prodRows.forEach((row: any) => {
      const planDateStr = row.GSTRP;
      const planQty = Number(row.PSMNG || 0);
      const actualQty = Number(row.LMNGA || 0);

      if (planDateStr < todayStr) {
        if (actualQty === 0 && planQty > 0) {
          missedProduction.push({
            date: fmtDate(planDateStr),
            qty: planQty,
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
    console.error('Simulation Execution Error:', error);
    return { success: false, message: error.message };
  }
}

export async function executeInventorySimulation(matnr: string, params: SimulationParams) {
  const productCode = matnr.trim();
  const paramsKey = JSON.stringify(params);

  return unstable_cache(
    async () => executeInventorySimulationUncached(productCode, params),
    ['inventory-simulation-v1', productCode, paramsKey],
    { revalidate: 600, tags: ['report-data'] }
  )();
}
