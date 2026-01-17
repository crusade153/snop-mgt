'use client'

import { useDashboardData } from '@/hooks/use-dashboard';
import { Calendar as CalendarIcon } from 'lucide-react';

export default function DeliveryPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  // 미납이 있는 품목만 필터링
  const unfulfilledList = data.integratedArray.filter(item => item.totalUnfulfilledQty > 0);
  
  // KPI 계산
  const totalUnfulfilledCount = unfulfilledList.reduce((acc, cur) => acc + cur.unfulfilledOrders.length, 0);

  return (
    <div className="space-y-6">
      {/* Header & Date Picker */}
      <PageHeader 
        title="🚨 미납 리스트 (Delivery Issue)" 
        desc="고객 약속 미이행 건 및 원인 집중 관리"
        dateRange={dateRange}
        setDateRange={setDateRange}
        onRefresh={refetch}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 디자인 시스템의 Brand Color(Red) 활용하여 경고 강조 */}
        <div className="p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-[#E53935] bg-[#FFEBEE]">
          <div className="text-[12px] font-bold text-[#E53935] mb-1">총 미납 주문 건수</div>
          <div className="text-[24px] font-bold text-[#C62828]">
            {totalUnfulfilledCount.toLocaleString()}
            <span className="text-[12px] font-normal ml-1 text-[#E53935] opacity-80">건</span>
          </div>
        </div>
        <div className="p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-[#E53935] bg-[#FFEBEE]">
          <div className="text-[12px] font-bold text-[#E53935] mb-1">총 미납 손실액</div>
          <div className="text-[24px] font-bold text-[#C62828]">
            {data.kpis.totalUnfulfilledValue.toLocaleString()}
            <span className="text-[12px] font-normal ml-1 text-[#E53935] opacity-80">원</span>
          </div>
        </div>
      </div>

      {/* Detail Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700">
          📋 제품별 미납 현황 (손실액 순)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납수량</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납금액</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">주요 원인</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">Max 지연</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {unfulfilledList
                .sort((a, b) => b.totalUnfulfilledValue - a.totalUnfulfilledValue) // 금액 높은 순 정렬
                .map((item) => {
                  // 가장 빈도 높은 원인 찾기
                  const causes = item.unfulfilledOrders.map(o => o.cause);
                  const majorCause = causes.sort((a,b) => 
                    causes.filter(v => v===a).length - causes.filter(v => v===b).length
                  ).pop() || '기타';
                  
                  const maxDelay = Math.max(...item.unfulfilledOrders.map(o => o.daysDelayed));

                  return (
                    <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900">{item.name}</div>
                        <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#E53935]">
                        {item.totalUnfulfilledQty.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-700 font-medium">
                        {item.totalUnfulfilledValue.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <CauseBadge cause={majorCause} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${maxDelay >= 7 ? 'text-[#E53935]' : 'text-neutral-500'}`}>
                          {maxDelay}일
                        </span>
                      </td>
                    </tr>
                  );
              })}
              {unfulfilledList.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-neutral-400">🎉 현재 미납 건이 없습니다!</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Sub Components ---

function CauseBadge({ cause }: { cause: string }) {
  const styles: Record<string, string> = {
    '재고 부족': 'bg-[#E3F2FD] text-[#1565C0] border border-[#BBDEFB]', // Blue
    '생산 차질': 'bg-[#FFF3E0] text-[#EF6C00] border border-[#FFE0B2]', // Orange
    '물류/출하 지연': 'bg-[#F3E5F5] text-[#7B1FA2] border border-[#E1BEE7]', // Purple
  };
  return (
    <span className={`px-2 py-1 rounded text-[11px] font-bold border ${styles[cause] || 'bg-[#F5F5F5] text-[#616161] border-[#E0E0E0]'}`}>
      {cause}
    </span>
  );
}

function PageHeader({ title, desc, dateRange, setDateRange, onRefresh }: any) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
      <div><h1 className="text-[20px] font-bold text-neutral-900">{title}</h1><p className="text-[12px] text-neutral-700 mt-1">{desc}</p></div>
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-neutral-200 shadow-sm"><CalendarIcon size={14} className="text-neutral-500" /><input type="date" value={dateRange.startDate} onChange={e => setDateRange((p:any) => ({ ...p, startDate: e.target.value }))} className="text-xs text-neutral-700 outline-none font-medium" /><span className="text-neutral-400 text-xs">~</span><input type="date" value={dateRange.endDate} onChange={e => setDateRange((p:any) => ({ ...p, endDate: e.target.value }))} className="text-xs text-neutral-700 outline-none font-medium" /><div className="w-[1px] h-4 bg-neutral-200 mx-1"></div><button onClick={() => onRefresh()} className="text-xs font-bold text-[#4A90E2] hover:text-blue-700 transition-colors">조회</button></div>
    </div>
  );
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div><span className="text-neutral-500 text-sm">데이터 분석 중...</span></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }