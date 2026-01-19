'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { ProductionRow } from '@/types/analysis';
import { Search, ChevronLeft, ChevronRight, Calendar, Factory } from 'lucide-react';
import { useUiStore } from '@/store/ui-store'; 

export default function ProductionPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore(); 

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlant, setSelectedPlant] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Helper: 단위 변환
  const formatQty = (val: number, conversion: number, baseUnit: string) => {
    if (unitMode === 'BOX') {
      const boxes = val / (conversion > 0 ? conversion : 1);
      return { 
        value: boxes.toLocaleString(undefined, { maximumFractionDigits: 1 }), 
        unit: 'BOX' 
      };
    }
    return { value: val.toLocaleString(), unit: baseUnit };
  };

  const { filteredList, kpi, plantOptions } = useMemo(() => {
    if (!data || !data.productionList) return { filteredList: [], kpi: { EA: {}, BOX: {}, KG: {} }, plantOptions: [] as string[] };

    const plants = Array.from(new Set(data.productionList.map((item: ProductionRow) => item.plant))).sort() as string[];

    let items = data.productionList.filter((item: ProductionRow) => {
      const isFinishedGood = item.code.startsWith('5');
      const matchPlant = selectedPlant === 'ALL' || item.plant === selectedPlant;
      const matchSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return isFinishedGood && matchPlant && matchSearch;
    });

    const kpiMap: any = {
      EA: { plan: 0, actual: 0, poor: 0 },
      BOX: { plan: 0, actual: 0, poor: 0 },
      KG: { plan: 0, actual: 0, poor: 0 }
    };

    items.forEach((item: ProductionRow) => {
      const u = item.unit.toUpperCase();
      if (!kpiMap[u]) kpiMap[u] = { plan: 0, actual: 0, poor: 0 };
      kpiMap[u].plan += item.planQty;
      kpiMap[u].actual += item.actualQty;
      if (item.status === 'poor') kpiMap[u].poor += 1;
    });

    items.sort((a: ProductionRow, b: ProductionRow) => b.date.localeCompare(a.date));

    return { filteredList: items, kpi: kpiMap, plantOptions: plants };
  }, [data, searchTerm, selectedPlant]);

  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredList.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredList, currentPage]);

  // 🚨 [수정] 누락되었던 변수 선언 추가
  const totalPages = Math.ceil(filteredList.length / itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="pb-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            🏭 생산 계획 및 실적 상세 (Production Status)
          </h1>
          <p className="text-[12px] text-neutral-700 mt-1">완제품 기준 모니터링</p>
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative">
            <Factory className="absolute left-3 top-2.5 text-neutral-500" size={16} />
            <select 
              value={selectedPlant} 
              onChange={(e) => { setSelectedPlant(e.target.value); setCurrentPage(1); }}
              className="pl-9 pr-8 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue bg-white appearance-none h-[38px] cursor-pointer"
            >
              <option value="ALL">전체 플랜트</option>
              {plantOptions.map((p: string) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="relative flex-1 md:w-64">
            <input 
              type="text" placeholder="제품명 또는 코드 검색..." value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue h-[38px]"
            />
            <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {['EA', 'BOX', 'KG'].map(unit => {
          const stats = kpi[unit] || { plan: 0, actual: 0, poor: 0 };
          const rate = stats.plan > 0 ? (stats.actual / stats.plan) * 100 : 0;
          return (
            <div key={unit} className="p-4 bg-white rounded shadow border border-neutral-200">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded">{unit}</span>
                <span className={`text-xs font-bold ${rate >= 90 ? 'text-[#2E7D32]' : 'text-[#EF6C00]'}`}>
                  달성률 {rate.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <div className="text-[10px] text-neutral-400">계획 합계</div>
                  <div className="text-lg font-bold text-neutral-800">{Math.round(stats.plan).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-neutral-400">실적 합계</div>
                  <div className="text-lg font-bold text-[#1565C0]">{Math.round(stats.actual).toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-neutral-100 text-[11px] text-neutral-500 flex justify-between">
                <span>부진 품목 수</span>
                <span className="font-bold text-[#E53935]">{stats.poor} 건</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-20 text-center">플랜트</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-24 text-center">계획일자</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">단위</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">
                  계획수량 ({unitMode === 'BOX' ? 'BOX' : '기준'})
                </th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">실적수량</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">달성률</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedItems.map((item: ProductionRow, idx: number) => {
                // 🚨 [변환]
                const dPlan = formatQty(item.planQty, item.umrezBox, item.unit);
                const dActual = formatQty(item.actualQty, item.umrezBox, item.unit);

                return (
                  <tr key={`${item.code}-${item.date}-${idx}`} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3 text-center text-neutral-600 font-bold text-xs">{item.plant}</td>
                    <td className="px-4 py-3 text-center text-neutral-600 font-mono text-xs">
                      <div className="flex items-center justify-center gap-1"><Calendar size={12} className="text-neutral-400" />{item.date}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{item.name}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{item.code}</div>
                    </td>
                    {/* 단위 표시도 동적으로 변경 */}
                    <td className="px-4 py-3 text-center text-neutral-500 text-xs font-bold">{dPlan.unit}</td>
                    <td className="px-4 py-3 text-right text-neutral-600">
                      {dPlan.value}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-800">
                      {dActual.value}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-bold ${item.rate < 90 ? 'text-[#EF6C00]' : 'text-[#1565C0]'}`}>{item.rate.toFixed(0)}%</span>
                    </td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={item.status} /></td>
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (<tr><td colSpan={8} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>)}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={20} /></button>
            <span className="text-sm font-bold text-neutral-600">{currentPage} / {totalPages}</span>
            <button onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: any = { completed: { bg: '#E8F5E9', text: '#2E7D32', label: '완료' }, progress: { bg: '#E3F2FD', text: '#1565C0', label: '진행' }, poor: { bg: '#FFEBEE', text: '#C62828', label: '부진' }, pending: { bg: '#F5F5F5', text: '#9E9E9E', label: '대기' }, };
  const s = config[status] || config.pending;
  return (<span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: s.bg, color: s.text }}>{s.label}</span>);
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }