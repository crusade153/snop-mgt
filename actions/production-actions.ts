'use server'

import bigqueryClient from '@/lib/bigquery';
import { SapProduction } from '@/types/sap';
import { unstable_cache } from 'next/cache';

async function getProductionPlanUncached(): Promise<SapProduction[]> {
  const query = `
    SELECT 
      AUFNR, AUART, TXT,
      MATNR, MAKTX,
      GSTRP, WERKS, ARBPL, KTEXT,
      PSMNG, LMNGA, WEMNG, MEINS,
      VORNR, DISPO, LTXA1
    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\`
    ORDER BY GSTRP DESC
    LIMIT 50
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    return rows as SapProduction[];
  } catch (error) {
    console.error('생산 계획 조회 실패:', error);
    return []; 
  }
}

export async function getProductionPlan(): Promise<SapProduction[]> {
  return unstable_cache(
    getProductionPlanUncached,
    ['production-plan-v1'],
    { revalidate: 600, tags: ['report-data'] }
  )();
}
