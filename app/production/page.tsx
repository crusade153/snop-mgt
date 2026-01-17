'use client'

import { useDashboardData } from '@/hooks/use-dashboard';
import { Calendar as CalendarIcon } from 'lucide-react';

export default function ProductionPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  const productionList = data.integratedArray.filter(
    item => item.production.planQty > 0 || item.production.receivedQty > 0
  );

  const totalPlan = productionList.reduce((acc, cur) => acc + cur.production.planQty, 0);
  const totalActual = productionList.reduce((acc, cur) => acc + cur.production.receivedQty, 0);
  const overallRate = totalPlan > 0 ? (totalActual / totalPlan) * 100 : 0;
  const poorItems = productionList.filter(item => item.production.achievementRate < 90).length;

  return (
    <div className="space-y-6">
      <PageHeader title="🏭 생산 분석" desc="계획 대 실적 비교 및 달성률 분석" dateRange={dateRange} setDateRange={setDateRange} onRefresh={refetch} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiBox label="전체 달성률" value={`${overallRate.toFixed(1)}%`} type="success" />
        <KpiBox label="총 계획 수량" value={totalPlan.toLocaleString()} unit="EA" type="blue" />
        <KpiBox label="총 생산 실적" value={totalActual.toLocaleString()} unit="EA" type="neutral" />
        <KpiBox label="부진 품목 (<90%)" value={poorItems} unit="개" type="warning" />
      </div>

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm text-left border-collapse">
          <thead className="bg-[#FAFAFA]">
            <tr>
              <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품명</th>
              <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">계획수량</th>
              <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">생산실적</th>
              <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">차이</th>
              <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">달성률</th>
              <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {productionList.sort((a, b) => a.production.achievementRate - b.production.achievementRate).map((item) => {
                const prod = item.production;
                const gap = prod.planQty - prod.receivedQty;
                const isPoor = prod.achievementRate < 90;
                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{item.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-700">{prod.planQty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-900">{prod.receivedQty.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right ${gap > 0 ? 'text-[#E53935]' : 'text-neutral-400'}`}>
                      {gap > 0 ? '-' : ''}{Math.abs(gap).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-700">{prod.achievementRate.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded text-[11px] font-bold ${isPoor ? 'bg-[#FFF3E0] text-[#EF6C00]' : 'bg-[#E8F5E9] text-[#2E7D32]'}`}>
                        {isPoor ? '부진' : '달성'}
                      </span>
                    </td>
                  </tr>
                );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ... 공통 컴포넌트 (PageHeader, LoadingSpinner, ErrorDisplay는 InventoryPage와 동일하므로 복사 사용 권장) ...
// KpiBox는 Dashboard의 것과 동일
function KpiBox({ label, value, unit, type }: any) {
  const styles: any = {
    brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]' },
    blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]' },
    success: { bg: 'bg-[#E8F5E9]', text: 'text-[#2E7D32]', label: 'text-[#43A047]' },
    warning: { bg: 'bg-[#FFF3E0]', text: 'text-[#EF6C00]', label: 'text-[#FFA726]' },
    neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]', label: 'text-[#757575]' },
  };
  const s = styles[type] || styles.neutral;
  return (
    <div className={`p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 ${s.bg}`}>
      <div className={`text-[12px] font-medium mb-1 ${s.label}`}>{label}</div>
      <div className={`text-[24px] font-bold ${s.text}`}>{value}<span className="text-[12px] font-normal ml-1 opacity-70">{unit}</span></div>
    </div>
  );
}

// (PageHeader, LoadingSpinner, ErrorDisplay는 위 InventoryPage 코드에서 복사해서 사용해주세요!)
// 편의를 위해 PageHeader만 다시 제공합니다.
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