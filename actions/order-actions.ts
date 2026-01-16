'use server'

import bigqueryClient from '@/lib/bigquery';
// types/sap.ts 파일이 없다면 이 줄에서 에러가 날 수 있습니다. 
// 만약 에러가 난다면 일단 이 줄을 지우고, 아래 Promise<SapOrder[]> 대신 Promise<any[]>로 바꿔주세요.
import { SapOrder } from '@/types/sap';

export async function getLatestOrders(): Promise<SapOrder[]> {
  const query = `
    SELECT 
      AUART, BEZEI_TVAKT, VBELN, POSNR, 
      KUNNR, NAME1, LGOBE, VDATU
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    ORDER BY VDATU DESC
    LIMIT 20
  `;

  try {
    const [rows] = await bigqueryClient.query({ query });
    
    // 데이터 반환
    return rows as SapOrder[];
  } catch (error) {
    console.error('주문 조회 실패:', error);
    return []; 
  }
}