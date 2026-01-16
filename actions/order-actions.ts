'use server'

import bigqueryClient from '@/lib/bigquery';
import { SapOrder } from '@/types/sap';

export async function getLatestOrders(): Promise<SapOrder[]> {
  const query = `
    SELECT 
      VBELN, POSNR, AUART, BEZEI_TVAKT, BSTKD,
      KUNNR, NAME1, KUNNR_WE, NAME1_KUNNR_WE,
      VKORG, VTEXT_TVKOT, VKGRP, BEZEI_TVGRT,
      WERKS, NAME1_WERKS, LGORT, LGOBE,
      MATNR, ARKTX, KWMENG, VRKME,
      NETWR, WAERK,
      VDATU, AUDAT_VBAK
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    ORDER BY VDATU DESC
    LIMIT 50
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    return rows as SapOrder[];
  } catch (error) {
    console.error('판매 오더 조회 실패:', error);
    return []; 
  }
}