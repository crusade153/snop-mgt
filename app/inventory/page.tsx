'use client'

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query'; 
import { getDashboardData } from '@/actions/dashboard-actions'; 
import { 
  Sliders, Search, TrendingUp, AlertTriangle, 
  CheckCircle, XCircle, ChevronLeft, ChevronRight,
  ShieldAlert, Layers, Percent, Eye, EyeOff, CheckSquare, Square // ✅ 아이콘 추가
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
    qualityStock: number; // ✅ 시뮬레이션용 품질 재고
    buckets: { 
        under50: number;
        r50_70: number;
        r70_75: number;
        r75_85: number;
        over85: number;
    }
  }
}

type AdsPeriod = 30 | 60 | 90;

export default function InventoryPage() {
  const { unitMode } = useUiStore(); 

  const [adsPeriod, setAdsPeriod] = useState<AdsPeriod>(60);
  
  const today = new Date();
  const endDate = format(subDays(today, 1), 'yyyy-MM-dd');
  const startDate = format(subDays(today, adsPeriod), 'yyyy-MM-dd');

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

  // 초기값 설정
  const [targetDays, setTargetDays] = useState<number>(30); 
  const [minShelfRate, setMinShelfRate] = useState<number>(30); 
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // ✅ [신규 기능] 숨은 재고 토글 및 시뮬레이션 포함 여부
  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const [includeQualityInSim, setIncludeQualityInSim] = useState(false);

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  const handlePeriodChange = (period: AdsPeriod) => {
    setAdsPeriod(period);
    setCurrentPage(1);
  };

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
    if (!data) return { all: [], kpi: { good: 0, shortage: 0, excess: 0, risk: 0, totalWaste: 0, wasteCount: 0 } };

    let items = data.integratedArray.filter((item: IntegratedItem) => {
      // ✅ [수정] 품질재고도 재고가 있는 것으로 간주 (표시 여부는 아래 필터링에서 결정하지 않음)
      const hasStock = item.inventory.totalStock > 0 || item.inventory.qualityStock > 0;
      const matchesSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return hasStock && matchesSearch;
    });

    const simulatedItems: SimulatedItem[] = items.map((item: IntegratedItem) => {
      const currentADS = item.inventory.ads || 0;
      
      let usableStock = item.inventory.batches
        .filter(b => b.remainRate >= minShelfRate) 
        .reduce((sum, b) => sum + b.quantity, 0);

      // ✅ [핵심] 옵션이 켜져있으면 품질재고를 가용재고에 합산하여 시뮬레이션
      if (includeQualityInSim) {
        usableStock += item.inventory.qualityStock;
      }

      const wasteStock = item.inventory.totalStock - item.inventory.batches
        .filter(b => b.remainRate >= minShelfRate) 
        .reduce((sum, b) => sum + b.quantity, 0); // 폐기 예상은 순수 가용재고 기준

      const targetStock = Math.ceil(currentADS * targetDays);
      const stockDays = currentADS > 0 ? usableStock / currentADS : 999;

      let simStatus: 'shortage' | 'excess' | 'good' = 'good';
      
      if (stockDays < targetDays) {
        simStatus = 'shortage';
      } 
      else if (stockDays > targetDays * 2) {
        simStatus = 'excess';
      }

      const futurePlan = item.production.futurePlanQty ?? 0;
      const isRisk = simStatus === 'shortage' && futurePlan === 0;

      const buckets = { under50: 0, r50_70: 0, r70_75: 0, r75_85: 0, over85: 0 };
      item.inventory.batches.forEach(b => {
          const r = b.remainRate;
          if (r < 50) buckets.under50 += b.quantity;
          else if (r < 70) buckets.r50_70 += b.quantity;
          else if (r < 75) buckets.r70_75 += b.quantity;
          else if (r < 85) buckets.r75_85 += b.quantity;
          else buckets.over85 += b.quantity;
      });

      return {
        ...item,
        sim: { 
            currentADS, targetStock, stockDays, simStatus, isRisk, usableStock, wasteStock, buckets,
            qualityStock: item.inventory.qualityStock // Sim 객체에 전달
        }
      };
    });

    const kpi = {
      shortage: simulatedItems.filter(i => i.sim.simStatus === 'shortage').length,
      excess: simulatedItems.filter(i => i.sim.simStatus === 'excess').length,
      risk: simulatedItems.filter(i => i.sim.isRisk).length,
      good: simulatedItems.filter(i => i.sim.simStatus === 'good').length,
      totalWaste: simulatedItems.reduce((acc, item) => acc + item.sim.wasteStock, 0),
      wasteCount: simulatedItems.filter(i => i.sim.wasteStock > 0).length 
    };

    simulatedItems.sort((a, b) => {
        if (a.sim.isRisk && !b.sim.isRisk) return -1;
        if (!a.sim.isRisk && b.sim.isRisk) return 1;
        return a.sim.stockDays - b.sim.stockDays;
    });

    return { all: simulatedItems, kpi };
  }, [data, targetDays, minShelfRate, searchTerm, includeQualityInSim]); // ✅ 의존성 추가

  const filteredAndPaginated = useMemo(() => {
    let list = simulation.all || [];

    if (filterStatus === 'GOOD') list = list.filter(i => i.sim.simStatus === 'good');
    else if (filterStatus === 'SHORTAGE') list = list.filter(i => i.sim.simStatus === 'shortage');
    else if (filterStatus === 'EXCESS') list = list.filter(i => i.sim.simStatus === 'excess');
    else if (filterStatus === 'WASTE') list = list.filter(i => i.sim.wasteStock > 0);

    const totalCount = list.length;
    const totalPages = Math.ceil(totalCount / itemsPerPage);
    const startIdx = (currentPage - 1) * itemsPerPage;
    const items = list.slice(startIdx, startIdx + itemsPerPage);

    return { items, totalPages, totalCount };
  }, [simulation.all, filterStatus, currentPage]);

  const handleFilterClick = (status: FilterStatus) => {
    if (filterStatus === status) setFilterStatus('ALL'); 
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
            <span>유통기한 잔여율(%) 기반 <strong>실질 가용 재고</strong> 시뮬레이션</span>
            <span className="w-[1px] h-3 bg-neutral-300"></span>
            <span className="text-primary-blue bg-blue-50 px-2 py-0.5 rounded text-[11px] font-bold border border-blue-100">
              조회기간: {startDate} ~ {endDate}
            </span>
          </p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-3 items-end md:items-center">
            {/* ✅ [신규] 숨은 재고 컨트롤러 */}
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setShowHiddenStock(!showHiddenStock)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                    showHiddenStock 
                        ? 'bg-purple-50 text-purple-700 border-purple-200' 
                        : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
                    }`}
                >
                    {showHiddenStock ? <Eye size={14}/> : <EyeOff size={14}/>}
                    {showHiddenStock ? '품질재고 숨기기' : '숨은 재고(품질) 보기'}
                </button>

                {showHiddenStock && (
                    <button 
                        onClick={() => setIncludeQualityInSim(!includeQualityInSim)}
                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                            includeQualityInSim 
                            ? 'bg-blue-600 text-white border-blue-600' 
                            : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
                        }`}
                        title="품질 대기 재고를 가용 재고에 포함하여 시뮬레이션합니다."
                    >
                        {includeQualityInSim ? <CheckSquare size={14}/> : <Square size={14}/>}
                        가용재고에 포함
                    </button>
                )}
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
              <div className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1 text-[#E65100]">
                <Percent size={14} /> 3. 납품 허용 기준 (잔여율)
              </div>
              <span className="text-lg font-bold text-[#E65100]">{minShelfRate}% 이상</span>
            </div>
            <input type="range" min="0" max="100" step="5" value={minShelfRate} onChange={(e) => setMinShelfRate(Number(e.target.value))} className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-[#E65100]" />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
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
          title={`가용불가(${minShelfRate}%미만)`} 
          value={simulation.kpi.totalWaste.toLocaleString()} 
          sub={`${simulation.kpi.wasteCount}개 품목`} 
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
            <span>📋 유효 재고 시뮬레이션 상세 (구간별 분포)</span>
            {filterStatus !== 'ALL' && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-white flex items-center gap-1">
                <Layers size={10} /> {filterStatus} 필터 적용중
              </span>
            )}
          </div>
          <span className="text-[11px] font-normal text-neutral-500">단위: {unitMode === 'BOX' ? 'BOX (환산)' : '기준 (EA/KG)'}</span>
        </div>
        
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-[20%]">제품명</th>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-right">총 재고</th>
                
                {/* ✅ [신규] 품질재고 컬럼 */}
                {showHiddenStock && (
                    <th className="px-2 py-3 border-b font-bold text-purple-700 text-right bg-purple-50">품질대기</th>
                )}

                {/* 구간별 컬럼 */}
                <th className="px-2 py-3 border-b font-bold text-[#C62828] text-right bg-red-50/30">~50%</th>
                <th className="px-2 py-3 border-b font-bold text-[#E65100] text-right bg-orange-50/30">50~70%</th>
                <th className="px-2 py-3 border-b font-bold text-[#F57F17] text-right bg-yellow-50/50">70~75%</th>
                <th className="px-2 py-3 border-b font-bold text-[#1565C0] text-right bg-blue-50/30">75~85%</th>
                <th className="px-2 py-3 border-b font-bold text-[#2E7D32] text-right bg-green-50/30">85%~</th>

                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-right">ADS ({adsPeriod}일)</th>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-right">보유일수</th>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-center">상태</th>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-center">생산(Future)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredAndPaginated.items.map((item: SimulatedItem) => {
                const dTotal = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                const dAds = formatQty(item.sim.currentADS, item.umrezBox, item.unit, 0); 
                const futurePlan = item.production.futurePlanQty ?? 0;
                const dPlan = formatQty(futurePlan, item.umrezBox, item.unit);
                const buckets = item.sim.buckets;
                
                // ✅ [신규] 품질재고
                const dQuality = formatQty(item.inventory.qualityStock, item.umrezBox, item.unit);

                return (
                  <tr key={item.code} className={`hover:bg-[#F9F9F9] transition-colors h-[48px] ${item.sim.isRisk ? 'bg-[#FFF8F8]' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-neutral-800">
                      {dTotal.value}
                    </td>

                    {/* ✅ [신규] 품질재고 셀 */}
                    {showHiddenStock && (
                        <td className="px-2 py-3 text-right font-bold text-purple-700 bg-purple-50/30">
                            {item.inventory.qualityStock > 0 ? dQuality.value : '-'}
                        </td>
                    )}

                    <td className="px-2 py-3 text-right text-[#C62828] bg-red-50/30 font-medium">
                        {buckets.under50 > 0 ? formatQty(buckets.under50, item.umrezBox, item.unit).value : '-'}
                    </td>
                    <td className="px-2 py-3 text-right text-[#E65100] bg-orange-50/30 font-medium">
                        {buckets.r50_70 > 0 ? formatQty(buckets.r50_70, item.umrezBox, item.unit).value : '-'}
                    </td>
                    <td className="px-2 py-3 text-right text-[#F57F17] bg-yellow-50/50 font-medium">
                        {buckets.r70_75 > 0 ? formatQty(buckets.r70_75, item.umrezBox, item.unit).value : '-'}
                    </td>
                    <td className="px-2 py-3 text-right text-[#1565C0] bg-blue-50/30 font-medium">
                        {buckets.r75_85 > 0 ? formatQty(buckets.r75_85, item.umrezBox, item.unit).value : '-'}
                    </td>
                    <td className="px-2 py-3 text-right text-[#2E7D32] bg-green-50/30 font-medium">
                        {buckets.over85 > 0 ? formatQty(buckets.over85, item.umrezBox, item.unit).value : '-'}
                    </td>

                    <td className="px-2 py-3 text-right text-neutral-600">
                      {dAds.value}
                    </td>
                    
                    {/* 보유일수: 옵션에 따라 달라질 수 있음을 색상으로 힌트 */}
                    <td className="px-2 py-3 text-right font-medium">
                      <span className={`${item.sim.simStatus === 'shortage' ? 'text-[#E53935] font-bold' : 'text-[#2E7D32]'}`}>
                        {item.sim.stockDays.toFixed(1)}일
                      </span>
                      {/* 가용재고 포함 옵션 활성화 시 아이콘 표시 */}
                      {includeQualityInSim && item.inventory.qualityStock > 0 && (
                        <span className="ml-1 text-[9px] text-purple-600 font-bold" title="품질재고 포함됨">+Q</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <SimulationBadge status={item.sim.simStatus} />
                    </td>
                    <td className="px-2 py-3 text-center">
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
              {filteredAndPaginated.items.length === 0 && <tr><td colSpan={showHiddenStock ? 12 : 11} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>}
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