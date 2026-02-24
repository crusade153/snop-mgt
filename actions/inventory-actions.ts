'use server'

import bigqueryClient from '@/lib/bigquery';
import { SapInventory } from '@/types/sap';

export async function getInventoryStatus(): Promise<SapInventory[]> {
  const query = `
    SELECT 
      MATNR, MATNR_T, MEINS, C_MEINS,
      PRDHA_1_T, PRDHA_2_T, PRDHA_3_T,
      LGORT, LGOBE,
      CLABS, CSPEM, CINSM,
      CHARG, HSDAT, VFDAT,
      remain_day, remain_rate, UMREZ_BOX
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
    WHERE CLABS > 0
      AND LGORT NOT IN ('2141', '2143', '2240', '2243')
      AND WERKS != '1031'  -- 플랜트 정보(WERKS)가 1031인 데이터 제외
    ORDER BY CLABS DESC
    LIMIT 50
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    return rows as SapInventory[];
  } catch (error) {
    console.error('재고 조회 실패:', error);
    return []; 
  }
}