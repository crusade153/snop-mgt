'use client'

import { useDashboardData } from '@/hooks/use-dashboard'; 
import { Calendar as CalendarIcon, Filter } from 'lucide-react';

export default function DashboardPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();

  // 로딩 상태 UI
  if (isLoading) return (
    <div className="flex items-center justify-center h-[calc(100vh-100px)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-primary-brand rounded-full animate-spin"></div>
        <span className="text-neutral-500 text-sm">데이터 분석 중...</span>
      </div>
    </div>
  );
  
  // 에러 상태 UI
  if (!data) return <div className="p-10 text-center text-status-error">데이터 로드 실패</div>;

  return (
    <div className="space-y-6">
      {/* 1. Page Header & Filter */}
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">종합 현황 Dashboard</h1>
          <p className="text-[12px] text-neutral-700 mt-1">전사 S&OP 핵심 지표 모니터링</p>
        </div>
        
        {/* Date Filter Component */}
        <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-neutral-200 shadow-sm">
          <CalendarIcon size={14} className="text-neutral-500" />
          <input 
            type="date" value={dateRange.startDate} 
            onChange={e => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
            className="text-xs text-neutral-700 outline-none font-medium" 
          />
          <span className="text-neutral-400 text-xs">~</span>
          <input 
            type="date" value={dateRange.endDate} 
            onChange={e => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
            className="text-xs text-neutral-700 outline-none font-medium" 
          />
          <div className="w-[1px] h-4 bg-neutral-200 mx-1"></div>
          <button 
            onClick={() => refetch()} 
            className="text-xs font-bold text-primary-blue hover:text-blue-700 transition-colors"
          >
            조회
          </button>
        </div>
      </div>

      {/* 2. KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard title="제품 매출" value={data.kpis.productSales} unit="원" type="blue" />
        <KpiCard title="상품 매출" value={data.kpis.merchandiseSales} unit="원" type="neutral" />
        <KpiCard title="미납 손실액" value={data.kpis.totalUnfulfilledValue} unit="원" type="brand" alert={true} />
        <KpiCard title="긴급 납품" value={data.kpis.criticalDeliveryCount} unit="건" type="warning" />
        <KpiCard title="재고 폐기/임박" value={data.stockHealth.disposed + data.stockHealth.critical} unit="건" type="warning" />
      </div>

      {/* 3. Analysis Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RankingCard title="🏆 Top 브랜드" data={data.salesAnalysis.byBrand} />
        <RankingCard title="📂 Top 카테고리" data={data.salesAnalysis.byCategory} />
        
        {/* 재고 건전성 (Custom Card) */}
        <div className="bg-white rounded p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[16px] font-semibold text-neutral-900">📦 재고 건전성</h2>
          </div>
          <div className="space-y-5">
            <StockBar label="양호 (Healthy)" value={data.stockHealth.healthy} total={data.integratedArray.length} color="bg-[#42A5F5]" />
            <StockBar label="긴급 (Critical)" value={data.stockHealth.critical} total={data.integratedArray.length} color="bg-[#FFA726]" />
            <StockBar label="폐기 (Disposed)" value={data.stockHealth.disposed} total={data.integratedArray.length} color="bg-[#E53935]" />
          </div>
        </div>
      </div>

      {/* 4. Table Section */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden mt-2">
        <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-white">
          <h2 className="text-[16px] font-semibold text-neutral-900">📋 통합 S&OP 상세 현황 (Top 20 위험 항목)</h2>
          <button className="text-xs text-neutral-500 flex items-center gap-1 hover:text-primary-blue">
            <Filter size={12} /> 필터
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">코드</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납금액</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">재고(BOX)</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">상태</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">ADS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.integratedArray
                .sort((a, b) => b.totalUnfulfilledValue - a.totalUnfulfilledValue)
                .slice(0, 20)
                .map((item) => (
                <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                  <td className="px-4 py-3 text-center text-neutral-500 font-mono text-xs">{item.code}</td>
                  <td className="px-4 py-3 text-neutral-900">{item.name}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary-brand">
                    {item.totalUnfulfilledValue.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-700">
                    {/* ✅ 수정됨: stock -> totalStock */}
                    {item.inventory.totalStock.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={item.inventory.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500">
                    {item.inventory.ads.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- UI Components ---

function KpiCard({ title, value, unit, type, alert }: any) {
  const styles: any = {
    brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]' },
    blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]' },
    warning: { bg: 'bg-[#FFF3E0]', text: 'text-[#EF6C00]', label: 'text-[#FFA726]' },
    neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]', label: 'text-[#757575]' },
  };
  const currentStyle = styles[type] || styles.neutral;
  return (
    <div className={`p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 ${currentStyle.bg} transition hover:-translate-y-1`}>
      <div className={`text-[12px] font-medium mb-1 ${currentStyle.label}`}>{title}</div>
      <div className={`text-[24px] font-bold ${currentStyle.text}`}>
        {value.toLocaleString()} 
        <span className="text-[12px] font-normal ml-1 opacity-70">{unit}</span>
      </div>
    </div>
  );
}

function RankingCard({ title, data }: any) {
  const topList = data.slice(0, 5);
  return (
    <div className="bg-white rounded p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
      <div className="flex justify-between items-center mb-4 pb-2 border-b border-neutral-100">
        <h2 className="text-[16px] font-semibold text-neutral-900">{title}</h2>
      </div>
      <ul className="space-y-3">
        {topList.map((item: any, idx: number) => (
          <li key={idx} className="flex justify-between items-center text-sm">
            <span className="flex items-center gap-3">
              <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ${idx < 3 ? 'bg-primary-blue text-white' : 'bg-neutral-100 text-neutral-500'}`}>
                {idx + 1}
              </span>
              <span className="text-neutral-700 truncate max-w-[140px]">{item.name}</span>
            </span>
            <span className="font-bold text-neutral-900">{item.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StockBar({ label, value, total, color }: any) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-medium text-neutral-700">{label}</span>
        <span className="font-bold text-neutral-900">{value}건</span>
      </div>
      <div className="w-full bg-neutral-100 rounded-sm h-2 overflow-hidden">
        <div className={`h-full rounded-sm ${color} transition-all duration-1000 ease-out`} style={{ width: `${percent}%` }}></div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string, text: string, label: string }> = {
    healthy: { bg: '#E3F2FD', text: '#1E88E5', label: '양호' },
    critical: { bg: '#FFF3E0', text: '#FB8C00', label: '긴급' },
    disposed: { bg: '#FFEBEE', text: '#E53935', label: '폐기' },
  };
  const current = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (
    <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: current.bg, color: current.text }}>
      {current.label}
    </span>
  );
}