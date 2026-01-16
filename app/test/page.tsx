'use client'

import { useState } from 'react';
import { testBigQueryConnection } from '@/actions/test-connection';

export default function TestPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleTest = async () => {
    setLoading(true);
    setResult(null);
    
    // Server Action 호출
    const response = await testBigQueryConnection();
    
    setResult(response);
    setLoading(false);
  };

  return (
    <div className="p-10 space-y-6">
      <h1 className="text-2xl font-bold">🛠 BigQuery 연결 테스트</h1>
      
      <div className="p-4 bg-gray-100 rounded-lg border">
        <p><strong>타겟 테이블:</strong> harim_sap_bi.SD_ZASSDDV0020</p>
        <p><strong>프로젝트 ID:</strong> harimfood-361004</p>
      </div>

      <button
        onClick={handleTest}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
      >
        {loading ? '연결 시도 중...' : '연결 테스트 시작'}
      </button>

      {/* 결과 출력 영역 */}
      {result && (
        <div className={`p-4 rounded border ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <h3 className="font-bold mb-2">
            {result.success ? '✅ 성공!' : '❌ 실패'}
          </h3>
          <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}