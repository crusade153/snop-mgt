'use client'

import { useDashboardData } from '@/hooks/use-dashboard';
import { Calendar as CalendarIcon } from 'lucide-react';

export default function FulfillmentPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  const { summary, byCustomer } = data.fulfillment;

  return (
    <div className="space-y-6">
      {/* 1. Page Header */}
      <PageHeader 
        title="✅ 납품 현황 (Fulfillment)" 
        desc="거래처별 납품 준수율 및 매출 효율성 분석" 
        dateRange={dateRange} 
        setDateRange={setDateRange} 
        onRefresh={refetch} 
      />

      {/* 2. KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiBox label="총 주문 건수" value={summary.totalOrders.toLocaleString()} unit="Line" type="blue" />
        <KpiBox label="완전 납품" value={summary.fulfilledOrders.toLocaleString()} unit="Line" type="success" />
        <KpiBox label="미납 발생" value={summary.unfulfilledCount.toLocaleString()} unit="Line" type="brand" />
        <KpiBox label="거래처 수" value={summary.totalCustomers.toLocaleString()} unit="개사" type="neutral" />
      </div>

      {/* 3. Data Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-5 border-b border-neutral-200 bg-white">
          <h2 className="text-[16px] font-semibold text-neutral-900">🏢 거래처별 납품 성과 (미납금액 순)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">거래처명</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">총 주문</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">총 매출액</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납 손실액</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 w-48 text-center">납품 준수율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {byCustomer.map((cust) => {
                const rate = cust.fulfillmentRate;
                const barColor = rate >= 95 ? 'bg-[#42A5F5]' : rate >= 80 ? 'bg-[#FFA726]' : 'bg-[#E53935]'; // Success/Wait/Fail Colors
                
                return (
                  <tr key={cust.id} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{cust.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{cust.id}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-700">
                      {cust.orderCount.toLocaleString()}건
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-900">
                      {Math.round(cust.totalRevenue / 10000).toLocaleString()}만원
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${cust.missedRevenue > 0 ? 'text-primary-brand' : 'text-neutral-300'}`}>
                      {cust.missedRevenue > 0 ? `${Math.round(cust.missedRevenue / 10000).toLocaleString()}만원` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-neutral-100 rounded-sm h-2 overflow-hidden">
                          <div className={`h-full rounded-sm ${barColor}`} style={{ width: `${rate}%` }}></div>
                        </div>
                        <span className="text-[11px] font-bold w-8 text-right text-neutral-700">{rate.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- 공통 컴포넌트 (PageHeader 등) 포함 ---

function PageHeader({ title, desc, dateRange, setDateRange, onRefresh }: any) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
      <div>
        <h1 className="text-[20px] font-bold text-neutral-900">{title}</h1>
        <p className="text-[12px] text-neutral-700 mt-1">{desc}</p>
      </div>
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-neutral-200 shadow-sm">
        <CalendarIcon size={14} className="text-neutral-500" />
        <input 
          type="date" value={dateRange.startDate} 
          onChange={e => setDateRange((p:any) => ({ ...p, startDate: e.target.value }))} 
          className="text-xs text-neutral-700 outline-none font-medium" 
        />
        <span className="text-neutral-400 text-xs">~</span>
        <input 
          type="date" value={dateRange.endDate} 
          onChange={e => setDateRange((p:any) => ({ ...p, endDate: e.target.value }))} 
          className="text-xs text-neutral-700 outline-none font-medium" 
        />
        <div className="w-[1px] h-4 bg-neutral-200 mx-1"></div>
        <button 
          onClick={() => onRefresh()} 
          className="text-xs font-bold text-[#4A90E2] hover:text-blue-700 transition-colors"
        >
          조회
        </button>
      </div>
    </div>
  );
}

function KpiBox({ label, value, unit, type }: any) {
  const styles: any = {
    brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]' },
    blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]' },
    success: { bg: 'bg-[#E8F5E9]', text: 'text-[#2E7D32]', label: 'text-[#42A5F5]' },
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

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-100px)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div>
        <span className="text-neutral-500 text-sm">데이터 분석 중...</span>
      </div>
    </div>
  );
}

function ErrorDisplay() {
  return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>;
}