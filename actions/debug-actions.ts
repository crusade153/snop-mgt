'use server'

import bigqueryClient from '@/lib/bigquery';

export async function debugTable(tableName: string) {
  const query = `
    SELECT *
    FROM \`${tableName}\`
    LIMIT 1
  `;

  try {
    console.log(`🔍 [Debug] 테이블 조회 시도: ${tableName}`);
    const [rows] = await bigqueryClient.query({ query });
    
    if (rows.length === 0) {
      return { success: true, message: "데이터가 0건입니다 (테이블은 존재함)", columns: [] };
    }

    const columns = Object.keys(rows[0]);
    return { success: true, data: rows[0], columns };

  } catch (error: any) {
    console.error(`❌ [Debug] 조회 실패:`, error.message);
    return { success: false, error: error.message };
  }
}