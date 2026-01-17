'use client'

import { useDashboardData } from '@/hooks/use-dashboard';
import { Calendar as CalendarIcon } from 'lucide-react';

export default function InventoryPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  // 재고가 있는 품목만 필터링 및 정렬
  const inventoryList = data.integratedArray
    .filter(item => item.inventory.stock > 0)
    .sort((a, b) => b.inventory.riskScore - a.inventory.riskScore);

  return (
    <div className="space-y-6">
      {/* Header & Date Picker */}
      <PageHeader 
        title="재고 완전 분석" 
        desc="동적 적정재고 산출(60일 판매 기준) 및 유통기한 시뮬레이션"
        dateRange={dateRange}
        setDateRange={setDateRange}
        onRefresh={refetch}
      />

      {/* KPI 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusCard label="양호 (Healthy)" count={data.stockHealth.healthy} color="bg-[#E3F2FD] text-[#1565C0] border-[#BBDEFB]" />
        <StatusCard label="긴급 (Critical)" count={data.stockHealth.critical} color="bg-[#FFF3E0] text-[#EF6C00] border-[#FFE0B2]" />
        <StatusCard label="폐기 (Disposed)" count={data.stockHealth.disposed} color="bg-[#FFEBEE] text-[#C62828] border-[#FFCDD2]" />
      </div>

      {/* 재고 테이블 */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 flex justify-between items-center">
          <h2 className="text-[14px] font-bold text-neutral-700">📦 상세 재고 리스트</h2>
          <span className="text-[12px] text-neutral-500">총 {inventoryList.length.toLocaleString()} 품목</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">코드</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">현재고</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 w-48">적정성 (권장대비)</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">잔여일</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">상태</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">위험도</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {inventoryList.map((item) => {
                const inv = item.inventory;
                const rec = inv.recommendedStock || 1;
                const pct = Math.min(100, (inv.stock / rec) * 100);
                const barColor = inv.stock < rec * 0.5 ? 'bg-[#EF5350]' : (inv.stock > rec * 1.5 ? 'bg-[#FFA726]' : 'bg-[#66BB6A]');

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3 text-neutral-500 font-mono text-xs">{item.code}</td>
                    <td className="px-4 py-3 font-medium text-neutral-900">{item.name}</td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-700">{inv.stock.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="w-full bg-neutral-100 rounded-full h-1.5 mb-1 relative overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }}></div>
                      </div>
                      <div className="text-[10px] text-neutral-400 flex justify-between">
                        <span>권장: {rec.toLocaleString()}</span>
                        <span>ADS: {inv.ads.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-right ${inv.remainingDays <= 30 ? 'text-[#E53935] font-bold' : 'text-neutral-600'}`}>
                      {inv.remainingDays}일
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-500">
                      {inv.riskScore.toFixed(0)}
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

// --- 공통 컴포넌트 (파일 하단에 포함) ---
function PageHeader({ title, desc, dateRange, setDateRange, onRefresh }: any) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
      <div>
        <h1 className="text-[20px] font-bold text-neutral-900">{title}</h1>
        <p className="text-[12px] text-neutral-700 mt-1">{desc}</p>
      </div>
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-neutral-200 shadow-sm">
        <CalendarIcon size={14} className="text-neutral-500" />
        <input type="date" value={dateRange.startDate} onChange={e => setDateRange((p:any) => ({ ...p, startDate: e.target.value }))} className="text-xs text-neutral-700 outline-none font-medium" />
        <span className="text-neutral-400 text-xs">~</span>
        <input type="date" value={dateRange.endDate} onChange={e => setDateRange((p:any) => ({ ...p, endDate: e.target.value }))} className="text-xs text-neutral-700 outline-none font-medium" />
        <div className="w-[1px] h-4 bg-neutral-200 mx-1"></div>
        <button onClick={() => onRefresh()} className="text-xs font-bold text-[#4A90E2] hover:text-blue-700 transition-colors">조회</button>
      </div>
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

function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }

function StatusCard({ label, count, color }: any) {
  return (
    <div className={`p-4 rounded border flex justify-between items-center ${color} shadow-sm`}>
      <span className="font-bold text-sm">{label}</span>
      <span className="text-2xl font-bold">{count}<span className="text-sm font-normal ml-1 opacity-70">건</span></span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: any = { healthy: { bg: '#E3F2FD', text: '#1976D2', label: '양호' }, critical: { bg: '#FFF3E0', text: '#F57C00', label: '긴급' }, disposed: { bg: '#FFEBEE', text: '#D32F2F', label: '폐기' } };
  const s = styles[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>;
}