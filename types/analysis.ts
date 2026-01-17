// types/analysis.ts
import { SapInventory, SapOrder, SapProduction } from './sap';


import { useState, useEffect } from 'react';
import { getDashboardData } from '@/actions/dashboard-actions';
import { DashboardAnalysis } from '@/types/analysis';
import { format, startOfMonth } from 'date-fns';

export default function DeliveryPage() {
  const [data, setData] = useState<DashboardAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  
  const startDate = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const endDate = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    async function init() {
      setLoading(true);
      const res = await getDashboardData(startDate, endDate);
      if (res.success && res.data) setData(res.data);
      setLoading(false);
    }
    init();
  }, []);

  if (loading) return <div className="p-10 text-center text-gray-500">🚚 미납 내역 분석 중...</div>;
  if (!data) return <div className="p-10 text-center text-red-500">데이터 로드 실패</div>;

  // 미납이 있는 품목만 필터링
  const unfulfilledList = data.integratedArray.filter(item => item.totalUnfulfilledQty > 0);
  
  // KPI
  const totalUnfulfilledCount = unfulfilledList.reduce((acc, cur) => acc + cur.unfulfilledOrders.length, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold text-gray-900">🚨 미납 리스트</h1>
        <p className="text-sm text-gray-500 mt-1">고객 약속 미이행 건 및 원인 분석</p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl border bg-red-50 border-red-200 text-red-900">
          <div className="text-sm font-bold opacity-80 mb-1">총 미납 주문 건수</div>
          <div className="text-2xl font-extrabold">{totalUnfulfilledCount.toLocaleString()}<span className="text-sm font-normal ml-1">건</span></div>
        </div>
        <div className="p-5 rounded-xl border bg-red-50 border-red-200 text-red-900">
          <div className="text-sm font-bold opacity-80 mb-1">총 미납 손실액</div>
          <div className="text-2xl font-extrabold">{data.kpis.totalUnfulfilledValue.toLocaleString()}<span className="text-sm font-normal ml-1">원</span></div>
        </div>
      </div>

      {/* 상세 테이블 */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-100 text-gray-700 font-bold uppercase text-xs">
            <tr>
              <th className="px-4 py-3">제품명</th>
              <th className="px-4 py-3 text-right">미납수량</th>
              <th className="px-4 py-3 text-right">미납금액</th>
              <th className="px-4 py-3 text-center">주요 원인</th>
              <th className="px-4 py-3 text-center">지연일(Max)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {unfulfilledList
              .sort((a, b) => b.totalUnfulfilledValue - a.totalUnfulfilledValue) // 금액 높은 순
              .map((item) => {
                // 가장 빈도 높은 원인 찾기
                const causes = item.unfulfilledOrders.map(o => o.cause);
                const majorCause = causes.sort((a,b) => 
                  causes.filter(v => v===a).length - causes.filter(v => v===b).length
                ).pop() || '기타';
                
                const maxDelay = Math.max(...item.unfulfilledOrders.map(o => o.daysDelayed));

                return (
                  <tr key={item.code} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{item.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-red-600">
                      {item.totalUnfulfilledQty.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {item.totalUnfulfilledValue.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CauseBadge cause={majorCause} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold ${maxDelay >= 7 ? 'text-red-600' : 'text-gray-600'}`}>
                        {maxDelay}일
                      </span>
                    </td>
                  </tr>
                );
            })}
            {unfulfilledList.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-gray-400">🎉 현재 미납 건이 없습니다!</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CauseBadge({ cause }: { cause: string }) {
  const styles: Record<string, string> = {
    '재고 부족': 'bg-blue-100 text-blue-700 border-blue-200',
    '생산 차질': 'bg-green-100 text-green-700 border-green-200',
    '물류/출하 지연': 'bg-orange-100 text-orange-700 border-orange-200',
  };
  return (
    <span className={`px-2 py-1 rounded text-xs font-bold border ${styles[cause] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {cause}
    </span>
  );
}