'use server'

import bigqueryClient from '@/lib/bigquery';

export async function testBigQueryConnection() {
  // 이미지의 정보를 바탕으로 정확한 테이블 경로 지정
  // 형식: `프로젝트ID.데이터셋.테이블명`
  const query = `
    SELECT *
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\`
    LIMIT 5
  `;

  try {
    console.log("📡 BigQuery 연결 시도 중...");
    
    // 쿼리 실행
    const [rows] = await bigqueryClient.query({ query });
    
    console.log("✅ 데이터 수신 성공:", rows.length, "건");
    
    // 결과 반환 (직렬화 가능한 객체여야 함)
    return { success: true, data: rows };
    
  } catch (error: any) {
    console.error("❌ BigQuery 연결 실패:", error);
    
    // 에러 메시지 반환
    return { success: false, error: error.message };
  }
}