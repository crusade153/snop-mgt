'use server'

import bigqueryClient from '@/lib/bigquery';

export async function testBigQueryConnection() {
  // 납품요청 테스트를 위해 '납품요청일(VDATU)' 기준으로 최신 데이터 5건만 조회
  const query = `
    SELECT 
      VBELN,  -- 주문번호
      POSNR,  -- 품목번호
      VDATU,  -- 납품요청일 (핵심)
      AUART,  -- 주문유형
      NAME1,  -- 거래처명
      LGOBE   -- 창고명
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    ORDER BY VDATU DESC
    LIMIT 5
  `;

  try {
    console.log("📡 BigQuery 연결 및 납품요청 데이터 조회 시도...");
    
    // 쿼리 실행
    const [rows] = await bigqueryClient.query({ query });
    
    console.log("✅ 데이터 수신 성공:", rows.length, "건");
    
    // 결과 반환
    return { success: true, data: rows };
    
  } catch (error: any) {
    console.error("❌ BigQuery 연결 실패:", error);
    return { success: false, error: error.message };
  }
}