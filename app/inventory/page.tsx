'use client'

import { useState, useMemo, useEffect } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { 
  Sliders, Search, TrendingUp, AlertTriangle, 
  CheckCircle, XCircle, ChevronLeft, ChevronRight 
} from 'lucide-react';
import { format, subDays } from 'date-fns';

type AdsPeriod = 30 | 60 | 90;

export default function InventoryPage() {
  const { data, isLoading, setDateRange, refetch } = useDashboardData();

  // 1. 사용자 입력 상태
  const [adsPeriod, setAdsPeriod] = useState<AdsPeriod>(60);
  const [targetDays, setTargetDays] = useState<number>(14);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  
  const itemsPerPage = 15;

  // 2. ADS 기간 변경 시 데이터 새로고침
  useEffect(() => {
    const today = new Date();
    const startDate = subDays(today, adsPeriod);
    
    setDateRange({
      startDate: format(startDate, 'yyyy-MM-dd'),
      endDate: format(today, 'yyyy-MM-dd')
    });
    
    setCurrentPage(1);
  }, [adsPeriod, setDateRange]);

  // 3. 시뮬레이션 및 데이터 가공
  const simulation = useMemo(() => {
    // ✅ [수정 포인트] 초기값의 키 이름을 'items'에서 'all'로 통일하여 에러 방지
    if (!data) return { all: [], totalCount: 0, filteredCount: 0 };

    let items = data.integratedArray.filter(item => {
      const hasStock = item.inventory.stock > 0;
      const matchesSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return hasStock && matchesSearch;
    });

    const simulatedItems = items.map(item => {
      const currentADS = item.inventory.ads || 0;
      const currentStock = item.inventory.stock;
      const targetStock = Math.ceil(currentADS * targetDays);
      const stockDays = currentADS > 0 ? currentStock / currentADS : 999;

      let simStatus: 'shortage' | 'excess' | 'good' = 'good';
      if (stockDays < targetDays * 0.5) simStatus = 'shortage';
      else if (stockDays > targetDays * 2) simStatus = 'excess';

      const isRisk = simStatus === 'shortage' && item.production.planQty === 0;

      return {
        ...item,
        sim: { currentADS, targetStock, stockDays, simStatus, isRisk }
      };
    });

    simulatedItems.sort((a, b) => b.inventory.stock - a.inventory.stock);

    // ✅ 여기서 키 이름이 'all'이므로 위쪽 초기값도 'all'이어야 함
    return {
      all: simulatedItems,
      totalCount: data.integratedArray.length,
      filteredCount: simulatedItems.length
    };
  }, [data, targetDays, searchTerm]);

  // 4. 페이지네이션 슬라이싱
  const paginatedItems = useMemo(() => {
    // ✅ 안전한 접근 (simulation.all이 없을 경우 빈 배열 처리)
    const list = simulation.all || [];
    const startIdx = (currentPage - 1) * itemsPerPage;
    return list.slice(startIdx, startIdx + itemsPerPage);
  }, [simulation.all, currentPage]);

  const totalPages = Math.ceil((simulation.all?.length || 0) / itemsPerPage);

  // KPI 계산
  const kpi = useMemo(() => {
    const list = simulation.all || [];
    return {
      shortage: list.filter(i => i.sim.simStatus === 'shortage').length,
      excess: list.filter(i => i.sim.simStatus === 'excess').length,
      risk: list.filter(i => i.sim.isRisk).length,
      good: list.filter(i => i.sim.simStatus === 'good').length,
    };
  }, [simulation.all]);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            📦 재고 종합 분석 (Inventory Simulator)
          </h1>
          <p className="text-[12px] text-neutral-700 mt-1">
            ADS 기준일과 목표 재고일수를 조정하여 최적의 재고 레벨을 시뮬레이션하세요.
          </p>
        </div>
        
        <div className="relative w-full md:w-64">
          <input 
            type="text" 
            placeholder="제품명 또는 코드 검색..." 
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue"
          />
          <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
        </div>
      </div>

      {/* Controller */}
      <div className="bg-white p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
        <div className="flex flex-col md:flex-row gap-8 items-center">
          <div className="flex-1 w-full">
            <div className="text-xs font-bold text-neutral-500 mb-3 uppercase tracking-wide flex items-center gap-1">
              <TrendingUp size={14} /> 1. 판매속도(ADS) 산출 기준
            </div>
            <div className="flex gap-2">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setAdsPeriod(d as AdsPeriod)}
                  className={`flex-1 py-2 px-3 text-sm font-bold rounded border transition-all
                    ${adsPeriod === d 
                      ? 'bg-[#E3F2FD] text-[#1565C0] border-[#1565C0] shadow-sm' 
                      : 'bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50'}`}
                >
                  최근 {d}일 평균
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-400 mt-2 text-center">
              * 선택한 기간({adsPeriod}일)의 실제 출고량을 기반으로 ADS를 다시 계산합니다.
            </p>
          </div>

          <div className="hidden md:block w-[1px] h-16 bg-neutral-200"></div>

          <div className="flex-1 w-full">
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1">
                <Sliders size={14} /> 2. 목표 운영일수 설정
              </div>
              <span className="text-lg font-bold text-primary-brand">{targetDays}일</span>
            </div>
            <input 
              type="range" min="7" max="60" step="1" 
              value={targetDays} 
              onChange={(e) => setTargetDays(Number(e.target.value))}
              className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-primary-brand"
            />
            <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
              <span>7일 (타이트)</span>
              <span>30일 (표준)</span>
              <span>60일 (여유)</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SimulationKpi title="전체 재고 품목" value={simulation.filteredCount} color="blue" icon={CheckCircle} />
        <SimulationKpi title="적정 (Good)" value={kpi.good} color="green" icon={CheckCircle} />
        <SimulationKpi title="부족 예상 (Short)" value={kpi.shortage} sub={`리스크: ${kpi.risk}건`} color="red" icon={AlertTriangle} />
        <SimulationKpi title="과잉 예상 (Excess)" value={kpi.excess} color="orange" icon={XCircle} />
      </div>

      {/* Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 flex justify-between items-center">
          <span>📋 시뮬레이션 상세 리스트</span>
          <span className="text-[11px] font-normal text-neutral-500">
            정렬: 재고수량 많은 순
          </span>
        </div>
        
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">현재고(BOX)</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">ADS ({adsPeriod}일)</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">보유일수</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-48 text-center">시뮬레이션 결과</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">목표재고</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">생산계획</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedItems.map((item) => (
                <tr key={item.code} className={`hover:bg-[#F9F9F9] transition-colors h-[48px] ${item.sim.isRisk ? 'bg-[#FFF8F8]' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-900">{item.name}</div>
                    <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-neutral-800 text-[13px]">
                    {item.inventory.stock.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-600">
                    {item.sim.currentADS.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    <span className={`${item.sim.stockDays < targetDays ? 'text-[#E53935] font-bold' : 'text-[#2E7D32]'}`}>
                      {item.sim.stockDays.toFixed(1)}일
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <SimulationBadge status={item.sim.simStatus} />
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500 text-[12px]">
                    {item.sim.targetStock.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.production.planQty > 0 ? (
                      <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">
                        {item.production.planQty.toLocaleString()} 예정
                      </span>
                    ) : (
                      item.sim.isRisk ? <span className="px-2 py-1 rounded bg-[#FFEBEE] text-[#C62828] text-[11px] font-bold">⚠️ 계획없음</span> : <span className="text-neutral-300 text-[11px]">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {paginatedItems.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-neutral-400">검색 결과가 없습니다.</td></tr>
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
            
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pNum = i + 1;
                if (totalPages > 5 && currentPage > 3) {
                  pNum = currentPage - 2 + i;
                  if (pNum > totalPages) pNum = totalPages - (4 - i);
                }
                
                return (
                  <button
                    key={pNum}
                    onClick={() => setCurrentPage(pNum)}
                    className={`w-8 h-8 rounded text-sm font-bold transition-colors
                      ${currentPage === pNum 
                        ? 'bg-primary-blue text-white' 
                        : 'bg-white text-neutral-600 border border-neutral-300 hover:bg-neutral-100'}`}
                  >
                    {pNum}
                  </button>
                );
              })}
            </div>

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

// --- UI Components ---
function SimulationKpi({ title, value, sub, color, icon: Icon }: any) {
  const colors: any = {
    blue: "text-[#1565C0] bg-[#E3F2FD] border-[#BBDEFB]",
    green: "text-[#2E7D32] bg-[#E8F5E9] border-[#C8E6C9]",
    red: "text-[#C62828] bg-[#FFEBEE] border-[#FFCDD2]",
    orange: "text-[#EF6C00] bg-[#FFF3E0] border-[#FFE0B2]",
  };
  const c = colors[color];

  return (
    <div className={`p-4 rounded border ${c} flex items-center justify-between shadow-sm`}>
      <div>
        <div className="text-[12px] font-bold opacity-80 uppercase mb-1">{title}</div>
        <div className="text-2xl font-bold flex items-end gap-2">
          {value.toLocaleString()} 
          {sub && <span className="text-[11px] font-medium opacity-80 pb-1">{sub}</span>}
        </div>
      </div>
      <Icon size={24} className="opacity-80" />
    </div>
  );
}

function SimulationBadge({ status }: { status: string }) {
  if (status === 'shortage') return <span className="px-2 py-1 rounded bg-[#FFEBEE] text-[#C62828] text-[11px] font-bold border border-[#FFCDD2]">부족 (Short)</span>;
  if (status === 'excess') return <span className="px-2 py-1 rounded bg-[#FFF3E0] text-[#EF6C00] text-[11px] font-bold border border-[#FFE0B2]">과잉 (Excess)</span>;
  return <span className="px-2 py-1 rounded bg-[#E8F5E9] text-[#2E7D32] text-[11px] font-bold border border-[#C8E6C9]">적정 (Good)</span>;
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }