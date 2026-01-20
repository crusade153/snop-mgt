'use client'

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query'; 
import { getDashboardData } from '@/actions/dashboard-actions'; 
import { 
  Sliders, Search, TrendingUp, AlertTriangle, 
  CheckCircle, XCircle, ChevronLeft, ChevronRight,
  ShieldAlert, Layers 
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { IntegratedItem, DashboardAnalysis } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 

type FilterStatus = 'ALL' | 'GOOD' | 'SHORTAGE' | 'EXCESS' | 'WASTE';

interface SimulatedItem extends IntegratedItem {
  sim: {
    currentADS: number;
    targetStock: number;
    stockDays: number;
    simStatus: 'shortage' | 'excess' | 'good';
    isRisk: boolean;
    usableStock: number;
    wasteStock: number;
  }
}

type AdsPeriod = 30 | 60 | 90;

export default function InventoryPage() {
  const { unitMode } = useUiStore(); 

  // 1. ADS 기간 설정 (기본 60일)
  const [adsPeriod, setAdsPeriod] = useState<AdsPeriod>(60);
  
  // 날짜 기간 필터 (Method B: 오늘은 제외)
  const today = new Date();
  const endDate = format(subDays(today, 1), 'yyyy-MM-dd');
  const startDate = format(subDays(today, adsPeriod), 'yyyy-MM-dd');

  // 2. 로컬 쿼리 실행
  const { data: rawData, isLoading } = useQuery<DashboardAnalysis>({
    queryKey: ['inventory-analysis', startDate, endDate], 
    queryFn: async () => {
      const res = await getDashboardData(startDate, endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    staleTime: 1000 * 60 * 5, 
    refetchOnWindowFocus: false,
  });

  const data = rawData;

  // 3. 사용자 입력 상태 & 필터 상태
  const [targetDays, setTargetDays] = useState<number>(14);
  const [minShelfLife, setMinShelfLife] = useState<number>(30); 
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');

  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  const handlePeriodChange = (period: AdsPeriod) => {
    setAdsPeriod(period);
    setCurrentPage(1);
  };

  // Helper: 단위 변환 함수
  const formatQty = (val: number | undefined | null, conversion: number, baseUnit: string, fixed?: number) => {
    const safeVal = val ?? 0;
    const maxDecimals = fixed !== undefined ? fixed : (unitMode === 'BOX' ? 1 : undefined);

    if (unitMode === 'BOX') {
      const boxes = safeVal / (conversion > 0 ? conversion : 1);
      return { 
        value: boxes.toLocaleString(undefined, { maximumFractionDigits: maxDecimals }), 
        unit: 'BOX' 
      };
    }
    return { 
      value: safeVal.toLocaleString(undefined, { maximumFractionDigits: maxDecimals }), 
      unit: baseUnit 
    };
  };

  // 4. 시뮬레이션 계산 로직
  const simulation = useMemo(() => {
    // 🚨 [수정] 초기값에 wasteCount: 0 추가 (타입 에러 해결)
    if (!data) return { all: [], kpi: { good: 0, shortage: 0, excess: 0, risk: 0, totalWaste: 0, wasteCount: 0 } };

    // 1차 필터: 검색어 & 재고 보유 여부
    let items = data.integratedArray.filter((item: IntegratedItem) => {
      const hasStock = item.inventory.totalStock > 0;
      const matchesSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return hasStock && matchesSearch;
    });

    const simulatedItems: SimulatedItem[] = items.map((item: IntegratedItem) => {
      const currentADS = item.inventory.ads || 0;
      
      const usableStock = item.inventory.batches
        .filter(b => b.remainDays >= minShelfLife)
        .reduce((sum, b) => sum + b.quantity, 0);

      const wasteStock = item.inventory.totalStock - usableStock;
      const targetStock = Math.ceil(currentADS * targetDays);
      const stockDays = currentADS > 0 ? usableStock / currentADS : 999;

      let simStatus: 'shortage' | 'excess' | 'good' = 'good';
      if (stockDays < targetDays * 0.5) simStatus = 'shortage';
      else if (stockDays > targetDays * 2) simStatus = 'excess';

      const futurePlan = item.production.futurePlanQty ?? 0;
      const isRisk = simStatus === 'shortage' && futurePlan === 0;

      return {
        ...item,
        sim: { currentADS, targetStock, stockDays, simStatus, isRisk, usableStock, wasteStock }
      };
    });

    // KPI 계산
    const kpi = {
      shortage: simulatedItems.filter(i => i.sim.simStatus === 'shortage').length,
      excess: simulatedItems.filter(i => i.sim.simStatus === 'excess').length,
      risk: simulatedItems.filter(i => i.sim.isRisk).length,
      good: simulatedItems.filter(i => i.sim.simStatus === 'good').length,
      totalWaste: simulatedItems.reduce((acc, item) => acc + item.sim.wasteStock, 0),
      wasteCount: simulatedItems.filter(i => i.sim.wasteStock > 0).length // 폐기 보유 품목 수
    };

    simulatedItems.sort((a, b) => b.sim.usableStock - a.sim.usableStock);

    return { all: simulatedItems, kpi };
  }, [data, targetDays, minShelfLife, searchTerm]); 

  // 5. 탭 필터링 적용 및 페이지네이션
  const filteredAndPaginated = useMemo(() => {
    let list = simulation.all || [];

    if (filterStatus === 'GOOD') {
      list = list.filter(i => i.sim.simStatus === 'good');
    } else if (filterStatus === 'SHORTAGE') {
      list = list.filter(i => i.sim.simStatus === 'shortage');
    } else if (filterStatus === 'EXCESS') {
      list = list.filter(i => i.sim.simStatus === 'excess');
    } else if (filterStatus === 'WASTE') {
      // 폐기 재고가 조금이라도 있는 품목만 표시
      list = list.filter(i => i.sim.wasteStock > 0);
    }

    const totalCount = list.length;
    const totalPages = Math.ceil(totalCount / itemsPerPage);
    const startIdx = (currentPage - 1) * itemsPerPage;
    const items = list.slice(startIdx, startIdx + itemsPerPage);

    return { items, totalPages, totalCount };
  }, [simulation.all, filterStatus, currentPage]);

  const handleFilterClick = (status: FilterStatus) => {
    if (filterStatus === status) setFilterStatus('ALL'); // 토글 (이미 선택된거 누르면 전체보기)
    else setFilterStatus(status);
    setCurrentPage(1);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            📦 재고 종합 분석 (Inventory Simulator)
          </h1>
          <p className="text-[12px] text-neutral-700 mt-1 flex items-center gap-2">
            <span>유통기한과 판매속도를 고려한 <strong>실질 가용 재고</strong> 분석</span>
            <span className="w-[1px] h-3 bg-neutral-300"></span>
            <span className="text-primary-blue bg-blue-50 px-2 py-0.5 rounded text-[11px] font-bold border border-blue-100">
              조회기간: {startDate} ~ {endDate} (오늘제외)
            </span>
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

      {/* Controller */}
      <div className="bg-white p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          <div>
            <div className="text-xs font-bold text-neutral-500 mb-3 uppercase tracking-wide flex items-center gap-1">
              <TrendingUp size={14} /> 1. 판매속도(ADS) 기준
            </div>
            <div className="flex gap-2">
              {[30, 60, 90].map((d) => (
                <button key={d} onClick={() => handlePeriodChange(d as AdsPeriod)} className={`flex-1 py-2 px-3 text-sm font-bold rounded border transition-all ${adsPeriod === d ? 'bg-[#E3F2FD] text-[#1565C0] border-[#1565C0]' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>최근 {d}일</button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1"><Sliders size={14} /> 2. 목표 운영일수</div>
              <span className="text-lg font-bold text-primary-brand">{targetDays}일</span>
            </div>
            <input type="range" min="7" max="60" step="1" value={targetDays} onChange={(e) => setTargetDays(Number(e.target.value))} className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-primary-brand" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1 text-[#E65100]"><ShieldAlert size={14} /> 3. 납품 허용 기준 (잔여일)</div>
              <span className="text-lg font-bold text-[#E65100]">{minShelfLife}일 이상</span>
            </div>
            <input type="range" min="0" max="360" step="5" value={minShelfLife} onChange={(e) => setMinShelfLife(Number(e.target.value))} className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-[#E65100]" />
          </div>
        </div>
      </div>

      {/* KPI Cards (Tabs) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SimulationKpi 
          title="적정 (Good)" 
          value={simulation.kpi.good} 
          color="green" 
          icon={CheckCircle} 
          active={filterStatus === 'GOOD'} 
          onClick={() => handleFilterClick('GOOD')}
        />
        <SimulationKpi 
          title="부족 예상 (Short)" 
          value={simulation.kpi.shortage} 
          sub={`리스크: ${simulation.kpi.risk}건`} 
          color="red" 
          icon={AlertTriangle} 
          active={filterStatus === 'SHORTAGE'}
          onClick={() => handleFilterClick('SHORTAGE')}
        />
        <SimulationKpi 
          title="과잉 예상 (Excess)" 
          value={simulation.kpi.excess} 
          color="orange" 
          icon={XCircle} 
          active={filterStatus === 'EXCESS'}
          onClick={() => handleFilterClick('EXCESS')}
        />
        <SimulationKpi 
          title="가용불가(폐기위험)" 
          value={simulation.kpi.totalWaste.toLocaleString()} 
          sub={`${simulation.kpi.wasteCount}개 품목 보유`} 
          color="gray" 
          icon={ShieldAlert} 
          active={filterStatus === 'WASTE'}
          onClick={() => handleFilterClick('WASTE')}
        />
      </div>

      {/* Result Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span>📋 유효 재고 시뮬레이션 상세</span>
            {filterStatus !== 'ALL' && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-white flex items-center gap-1">
                <Layers size={10} /> {filterStatus} 필터 적용중 ({filteredAndPaginated.totalCount}건)
              </span>
            )}
          </div>
          <span className="text-[11px] font-normal text-neutral-500">단위: {unitMode === 'BOX' ? 'BOX (환산)' : '기준 (EA/KG)'}</span>
        </div>
        
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">총 재고</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right text-[#1565C0] bg-[#E3F2FD]/30">유효 재고</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right text-[#E53935] bg-[#FFEBEE]/30">조건 미달</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">ADS ({adsPeriod}일)</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">보유일수</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center">상태</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center">생산계획 (Future)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredAndPaginated.items.map((item: SimulatedItem) => {
                const dTotal = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                const dUsable = formatQty(item.sim.usableStock, item.umrezBox, item.unit);
                const dWaste = formatQty(item.sim.wasteStock, item.umrezBox, item.unit);
                const dAds = formatQty(item.sim.currentADS, item.umrezBox, item.unit, 0); 
                
                // futurePlanQty 사용
                const futurePlan = item.production.futurePlanQty ?? 0;
                const dPlan = formatQty(futurePlan, item.umrezBox, item.unit);

                return (
                  <tr key={item.code} className={`hover:bg-[#F9F9F9] transition-colors h-[48px] ${item.sim.isRisk ? 'bg-[#FFF8F8]' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{item.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-400">
                      {dTotal.value}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[#1565C0] bg-[#E3F2FD]/30">
                      {dUsable.value}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[#E53935] bg-[#FFEBEE]/30">
                      {item.sim.wasteStock > 0 ? dWaste.value : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-600">
                      {dAds.value}
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
                      {futurePlan > 0 ? (
                        <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">
                          {dPlan.value}
                        </span>
                      ) : (
                        item.sim.isRisk ? <span className="px-2 py-1 rounded bg-[#FFEBEE] text-[#C62828] text-[11px] font-bold">⚠️ 계획없음</span> : <span className="text-neutral-300 text-[11px]">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredAndPaginated.items.length === 0 && <tr><td colSpan={8} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        
        {filteredAndPaginated.totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={20} /></button>
            <span className="text-sm text-neutral-600 font-medium">Page {currentPage} of {filteredAndPaginated.totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(filteredAndPaginated.totalPages, p + 1))} disabled={currentPage === filteredAndPaginated.totalPages} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- UI Components ---
function SimulationKpi({ title, value, sub, color, icon: Icon, active, onClick }: any) {
  const styles: any = {
    blue: { base: "text-[#1565C0] bg-[#E3F2FD] border-[#BBDEFB]", active: "ring-2 ring-[#1565C0] ring-offset-2" },
    green: { base: "text-[#2E7D32] bg-[#E8F5E9] border-[#C8E6C9]", active: "ring-2 ring-[#2E7D32] ring-offset-2 bg-[#C8E6C9]" },
    red: { base: "text-[#C62828] bg-[#FFEBEE] border-[#FFCDD2]", active: "ring-2 ring-[#C62828] ring-offset-2 bg-[#FFCDD2]" },
    orange: { base: "text-[#EF6C00] bg-[#FFF3E0] border-[#FFE0B2]", active: "ring-2 ring-[#EF6C00] ring-offset-2 bg-[#FFE0B2]" },
    gray: { base: "text-[#616161] bg-[#F5F5F5] border-[#E0E0E0]", active: "ring-2 ring-[#616161] ring-offset-2 bg-[#E0E0E0]" },
  };
  const s = styles[color] || styles.gray;
  
  return (
    <div 
      onClick={onClick}
      className={`
        p-4 rounded border flex items-center justify-between shadow-sm cursor-pointer transition-all hover:-translate-y-1
        ${s.base}
        ${active ? s.active : 'hover:opacity-90'}
      `}
    >
      <div>
        <div className="text-[12px] font-bold opacity-80 uppercase mb-1">{title}</div>
        <div className="text-2xl font-bold flex items-end gap-2">
          {value} 
          {sub && <span className="text-[11px] font-medium opacity-80 pb-1">{sub}</span>}
        </div>
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