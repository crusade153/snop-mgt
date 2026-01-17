'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { 
  Search, Calendar, ChevronLeft, ChevronRight 
} from 'lucide-react';
import { IntegratedItem } from '@/types/analysis'; // ✅ 타입 Import

type TabType = 'all' | 'healthy' | 'critical' | 'imminent' | 'disposed';

export default function StockStatusPage() {
  const { data, isLoading } = useDashboardData();

  // 1. 상태 관리
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // 2. 데이터 필터링 및 가공
  const filteredData = useMemo(() => {
    if (!data) return [];

    // ✅ [수정] item에 IntegratedItem 타입 명시
    let items = data.integratedArray.filter((item: IntegratedItem) => item.inventory.totalStock > 0);

    // 탭 필터
    if (activeTab !== 'all') {
      items = items.filter((item: IntegratedItem) => item.inventory.status === activeTab);
    }

    // 검색 필터
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      items = items.filter((item: IntegratedItem) => 
        item.name.toLowerCase().includes(lower) || 
        item.code.includes(lower)
      );
    }

    // 정렬 (임박/폐기 우선, 그 다음 잔여일 짧은 순)
    // ✅ [수정] a, b에 IntegratedItem 타입 명시
    items.sort((a: IntegratedItem, b: IntegratedItem) => a.inventory.remainingDays - b.inventory.remainingDays);

    return items;
  }, [data, activeTab, searchTerm]);

  // 3. 페이지네이션
  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  // 4. 로딩/에러 처리
  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
          📦 재고 상세 현황 (Current Stock Status)
        </h1>
        <p className="text-[12px] text-neutral-700 mt-1">
          전체 재고의 유통기한 및 잔여율 집중 모니터링
        </p>
      </div>

      {/* 🎛️ 컨트롤 패널 (탭 + 검색) */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Tabs */}
        <div className="flex bg-neutral-100 p-1 rounded-lg">
          {/* ✅ [수정] filter 내부 타입 명시 */}
          <TabButton label="전체" count={data.integratedArray.filter((i: IntegratedItem)=>i.inventory.totalStock>0).length} active={activeTab === 'all'} onClick={() => { setActiveTab('all'); setCurrentPage(1); }} />
          <TabButton label="양호" count={data.stockHealth.healthy} active={activeTab === 'healthy'} onClick={() => { setActiveTab('healthy'); setCurrentPage(1); }} color="text-[#1565C0]" />
          <TabButton label="긴급 (60일↓)" count={data.stockHealth.critical} active={activeTab === 'critical'} onClick={() => { setActiveTab('critical'); setCurrentPage(1); }} color="text-[#F57F17]" />
          <TabButton label="임박 (30일↓)" count={data.stockHealth.imminent} active={activeTab === 'imminent'} onClick={() => { setActiveTab('imminent'); setCurrentPage(1); }} color="text-[#E65100]" />
          <TabButton label="폐기" count={data.stockHealth.disposed} active={activeTab === 'disposed'} onClick={() => { setActiveTab('disposed'); setCurrentPage(1); }} color="text-[#C62828]" />
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <input 
            type="text" 
            placeholder="제품명 또는 코드 검색..." 
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue bg-white"
          />
          <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-16 text-center">No</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">상태</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품코드</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">단위</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">총 수량</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">소비기한 (최단)</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">잔여일수</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">잔여율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {/* ✅ [수정] map 인자 타입 명시 */}
              {paginatedItems.map((item: IntegratedItem, idx: number) => {
                const worstBatch = item.inventory.batches.sort((a, b) => a.remainDays - b.remainDays)[0];
                const expiryDate = worstBatch ? worstBatch.expirationDate : '-';
                const remainRate = worstBatch ? worstBatch.remainRate : 0;

                const daysColor = item.inventory.status === 'imminent' ? 'text-[#E65100] font-bold' : 
                                  (item.inventory.status === 'critical' ? 'text-[#F57F17] font-bold' : 'text-neutral-600');

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">
                      {(currentPage - 1) * itemsPerPage + idx + 1}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={item.inventory.status} />
                    </td>
                    <td className="px-4 py-3 text-neutral-500 font-mono text-xs">{item.code}</td>
                    <td className="px-4 py-3 font-medium text-neutral-900">{item.name}</td>
                    <td className="px-4 py-3 text-center text-neutral-500">{item.unit}</td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-800">
                      {item.inventory.totalStock.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-neutral-600">
                      <div className="flex items-center justify-center gap-1">
                        <Calendar size={12} className="text-neutral-400" />
                        {expiryDate}
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-right ${daysColor}`}>
                      {item.inventory.remainingDays}일
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${remainRate < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>
                        {remainRate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-neutral-400">검색된 재고가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm font-bold text-neutral-600">{currentPage} / {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Local Components ---

function TabButton({ label, count, active, onClick, color }: any) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold transition-all
        ${active ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}
      `}
    >
      <span className={active && color ? color : ''}>{label}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-neutral-100' : 'bg-neutral-200'}`}>
        {count}
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: any = {
    healthy: { bg: '#E3F2FD', text: '#1E88E5', label: '양호' },
    critical: { bg: '#FFF8E1', text: '#F57F17', label: '긴급' }, 
    imminent: { bg: '#FFF3E0', text: '#E65100', label: '임박' }, 
    disposed: { bg: '#FFEBEE', text: '#E53935', label: '폐기' },
  };
  const current = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (
    <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: current.bg, color: current.text }}>
      {current.label}
    </span>
  );
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }