'use client'

import { useState } from 'react';
import { debugTable } from '@/actions/debug-actions';

export default function DebugPage() {
  const [result, setResult] = useState<any>(null);

  const tables = [
    { name: "1. 재고 현황 (V_MM_MCHB)", id: "harimfood-361004.harim_sap_bi_user.V_MM_MCHB" },
    { name: "2. 생산 계획 (PP_ZASPPR1110)", id: "harimfood-361004.harim_sap_bi.PP_ZASPPR1110" },
    { name: "3. 판매 오더 (SD_ZASSDDV0020)", id: "harimfood-361004.harim_sap_bi.SD_ZASSDDV0020" }
  ];

  const handleCheck = async (tableName: string) => {
    setResult("조회 중...");
    const res = await debugTable(tableName);
    setResult(res);
  };

  return (
    <div className="p-10 space-y-8 bg-gray-900 min-h-screen text-gray-100">
      <h1 className="text-2xl font-bold text-white">🕵️‍♀️ 테이블 구조 진단 (S&OP 데이터셋)</h1>
      
      <div className="flex gap-4">
        {tables.map((t) => (
          <button
            key={t.id}
            onClick={() => handleCheck(t.id)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition shadow-lg"
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="p-6 bg-gray-800 rounded-lg border border-gray-700 min-h-[400px]">
        {result === "조회 중..." ? (
          <div className="text-yellow-400 animate-pulse">데이터베이스 조회 중...</div>
        ) : result ? (
          <div>
            {result.success ? (
              <>
                <h3 className="text-green-400 font-bold mb-4">✅ 조회 성공! 아래 데이터를 캡처해주세요.</h3>
                <div className="grid grid-cols-1 gap-4">
                  <div className="bg-gray-950 p-4 rounded overflow-auto border border-gray-600">
                    <div className="text-sm text-gray-400 mb-2 font-bold">샘플 데이터 (전체 컬럼 포함)</div>
                    <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap">
                      {JSON.stringify(result.data, null, 2)}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-red-400 font-bold mb-2">❌ 조회 실패</h3>
                <p className="text-white bg-red-900/50 p-4 rounded font-mono text-sm">
                  {result.error}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="text-gray-500 text-center py-20">버튼을 눌러 테이블 구조를 확인하세요.</div>
        )}
      </div>
    </div>
  );
}