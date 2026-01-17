'use client'

import { useState, useMemo, useEffect } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { 
  Sliders, Search, TrendingUp, AlertTriangle, 
  CheckCircle, XCircle, ChevronLeft, ChevronRight,
  ShieldAlert 
} from 'lucide-react';
import { format, subDays } from 'date-fns';

type AdsPeriod = 30 | 60 | 90;

export default function InventoryPage() {
  const { data, isLoading, setDateRange } = useDashboardData();

  // 1. 사용자 입력 상태
  const [adsPeriod, setAdsPeriod] = useState<AdsPeriod>(60);
  const [targetDays, setTargetDays] = useState<number>(14);
  
  // ✅ [수정됨] 납품 허용 기준 (최소 잔여 유통기한)
  const [minShelfLife, setMinShelfLife] = useState<number>(30); 

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

  // 3. 시뮬레이션 및 데이터 가공 (Core Logic)
  const simulation = useMemo(() => {
    if (!data) return { all: [], totalCount: 0, filteredCount: 0 };

    let items = data.integratedArray.filter(item => {
      const hasStock = item.inventory.totalStock > 0;
      const matchesSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return hasStock && matchesSearch;
    });

    const simulatedItems = items.map(item => {
      const currentADS = item.inventory.ads || 0;
      
      // ✅ [핵심] 유효 재고 계산 (시뮬레이션)
      // 전체 재고 중, 설정한 '최소 잔여일(minShelfLife)' 이상 남은 배치만 합산
      const usableStock = item.inventory.batches
        .filter(b => b.remainDays >= minShelfLife)
        .reduce((sum, b) => sum + b.quantity, 0);

      // 폐기/부실 재고 (조건 미달)
      const wasteStock = item.inventory.totalStock - usableStock;

      // 목표 재고량
      const targetStock = Math.ceil(currentADS * targetDays);
      
      // 보유일수 (유효 재고 기준!)
      const stockDays = currentADS > 0 ? usableStock / currentADS : 999;

      // 상태 판정 (유효 재고 기준)
      let simStatus: 'shortage' | 'excess' | 'good' = 'good';
      if (stockDays < targetDays * 0.5) simStatus = 'shortage';
      else if (stockDays > targetDays * 2) simStatus = 'excess';

      // 리스크: 부족한데 생산계획도 없음
      const isRisk = simStatus === 'shortage' && item.production.planQty === 0;

      return {
        ...item,
        sim: { 
          currentADS, 
          targetStock, 
          stockDays, 
          simStatus, 
          isRisk,
          usableStock, // 유효 재고
          wasteStock   // 조건 미달 재고 (잠재적 폐기)
        }
      };
    });

    // 정렬: 유효 재고 수량 많은 순
    simulatedItems.sort((a, b) => b.sim.usableStock - a.sim.usableStock);

    return {
      all: simulatedItems,
      totalCount: data.integratedArray.length,
      filteredCount: simulatedItems.length
    };
  }, [data, targetDays, minShelfLife, searchTerm]); 

  // 4. 페이지네이션
  const paginatedItems = useMemo(() => {
    const list = simulation.all || [];
    const startIdx = (currentPage - 1) * itemsPerPage;
    return list.slice(startIdx, startIdx + itemsPerPage);
  }, [simulation.all, currentPage]);

  const totalPages = Math.ceil((simulation.all?.length || 0) / itemsPerPage);

  // KPI
  const kpi = useMemo(() => {
    const list = simulation.all || [];
    const totalWaste = list.reduce((acc, item) => acc + item.sim.wasteStock, 0);
    return {
      shortage: list.filter(i => i.sim.simStatus === 'shortage').length,
      excess: list.filter(i => i.sim.simStatus === 'excess').length,
      risk: list.filter(i => i.sim.isRisk).length,
      good: list.filter(i => i.sim.simStatus === 'good').length,
      totalWaste 
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
            유통기한과 판매속도를 고려한 <strong>실질 가용 재고(Effective Stock)</strong> 분석
          </p>
        </div>
        <div className="relative w-full md:w-64">
          <input 
            type="text" placeholder="제품명 또는 코드 검색..." value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue"
          />
          <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
        </div>
      </div>

      {/* 🎛️ 시뮬레이션 컨트롤러 (3단 구성) */}
      <div className="bg-white p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          
          {/* 1. ADS 기준 */}
          <div>
            <div className="text-xs font-bold text-neutral-500 mb-3 uppercase tracking-wide flex items-center gap-1">
              <TrendingUp size={14} /> 1. 판매속도(ADS) 기준
            </div>
            <div className="flex gap-2">
              {[30, 60, 90].map((d) => (
                <button key={d} onClick={() => setAdsPeriod(d as AdsPeriod)}
                  className={`flex-1 py-2 px-3 text-sm font-bold rounded border transition-all ${adsPeriod === d ? 'bg-[#E3F2FD] text-[#1565C0] border-[#1565C0]' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>
                  최근 {d}일
                </button>
              ))}
            </div>
          </div>

          {/* 2. 목표 재고일수 */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1">
                <Sliders size={14} /> 2. 목표 운영일수
              </div>
              <span className="text-lg font-bold text-primary-brand">{targetDays}일</span>
            </div>
            <input type="range" min="7" max="60" step="1" value={targetDays} onChange={(e) => setTargetDays(Number(e.target.value))}
              className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-primary-brand" />
            <div className="flex justify-between text-[10px] text-neutral-400 mt-1"><span>7일 (타이트)</span><span>60일 (여유)</span></div>
          </div>

          {/* 3. 납품 허용 기준 (수정됨: Max 360일) */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1 text-[#E65100]">
                <ShieldAlert size={14} /> 3. 납품 허용 기준 (잔여일)
              </div>
              <span className="text-lg font-bold text-[#E65100]">{minShelfLife}일 이상</span>
            </div>
            {/* ✅ max="360"으로 수정됨 */}
            <input type="range" min="0" max="360" step="5" value={minShelfLife} onChange={(e) => setMinShelfLife(Number(e.target.value))}
              className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-[#E65100]" />
            <p className="text-[11px] text-neutral-400 mt-2 text-right">
              * 잔여 {minShelfLife}일 미만 재고는 <strong>가용 불가</strong>로 간주
            </p>
          </div>

        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SimulationKpi title="적정 (Good)" value={kpi.good} color="green" icon={CheckCircle} />
        <SimulationKpi title="부족 예상 (Short)" value={kpi.shortage} sub={`리스크: ${kpi.risk}건`} color="red" icon={AlertTriangle} />
        <SimulationKpi title="과잉 예상 (Excess)" value={kpi.excess} color="orange" icon={XCircle} />
        {/* 폐기 잠재 KPI 추가 */}
        <SimulationKpi title="가용불가(폐기위험)" value={kpi.totalWaste.toLocaleString()} sub="Box (조건 미달)" color="gray" icon={ShieldAlert} />
      </div>

      {/* Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 flex justify-between items-center">
          <span>📋 유효 재고 시뮬레이션 상세</span>
          <span className="text-[11px] font-normal text-neutral-500">정렬: 유효재고 많은 순</span>
        </div>
        
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">총 재고</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right text-[#1565C0] bg-[#E3F2FD]/30">유효 재고</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right text-[#E53935] bg-[#FFEBEE]/30">조건 미달</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">ADS ({adsPeriod}일)</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">보유일수(유효)</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">상태</th>
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
                  <td className="px-4 py-3 text-right text-neutral-400">
                    {item.inventory.totalStock.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-[#1565C0] bg-[#E3F2FD]/30">
                    {item.sim.usableStock.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-[#E53935] bg-[#FFEBEE]/30">
                    {item.sim.wasteStock > 0 ? item.sim.wasteStock.toLocaleString() : '-'}
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
                  <td className="px-4 py-3 text-center">
                    {item.production.planQty > 0 ? (
                      <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">
                        {item.production.planQty.toLocaleString()}
                      </span>
                    ) : (
                      item.sim.isRisk ? <span className="px-2 py-1 rounded bg-[#FFEBEE] text-[#C62828] text-[11px] font-bold">⚠️ 계획없음</span> : <span className="text-neutral-300 text-[11px]">-</span>
                    )}
                  </td>
                </tr>
              ))}
              {paginatedItems.length === 0 && <tr><td colSpan={8} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={20} /></button>
            <span className="text-sm text-neutral-600 font-medium">Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={20} /></button>
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
    gray: "text-[#616161] bg-[#F5F5F5] border-[#E0E0E0]",
  };
  const c = colors[color] || colors.gray;
  return (
    <div className={`p-4 rounded border ${c} flex items-center justify-between shadow-sm`}>
      <div>
        <div className="text-[12px] font-bold opacity-80 uppercase mb-1">{title}</div>
        <div className="text-2xl font-bold flex items-end gap-2">{value} {sub && <span className="text-[11px] font-medium opacity-80 pb-1">{sub}</span>}</div>
      </div>
      <Icon size={24} className="opacity-80" />
    </div>
  );
}

function SimulationBadge({ status }: { status: string }) {
  if (status === 'shortage') return <span className="px-2 py-1 rounded bg-[#FFEBEE] text-[#C62828] text-[11px] font-bold border border-[#FFCDD2]">부족</span>;
  if (status === 'excess') return <span className="px-2 py-1 rounded bg-[#FFF3E0] text-[#EF6C00] text-[11px] font-bold border border-[#FFE0B2]">과잉</span>;
  return <span className="px-2 py-1 rounded bg-[#E8F5E9] text-[#2E7D32] text-[11px] font-bold border border-[#C8E6C9]">적정</span>;
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }