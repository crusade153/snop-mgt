'use client'

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query'; 
import { getDashboardData } from '@/actions/dashboard-actions'; 
import { 
  Sliders, Search, TrendingUp, AlertTriangle, 
  CheckCircle, XCircle, ChevronLeft, ChevronRight,
  ShieldAlert, Layers, Percent, Eye, EyeOff, CheckSquare, Square,
  ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { IntegratedItem, DashboardAnalysis, ProductionRow, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 
import { useDateStore } from '@/store/date-store';

type FilterStatus = 'ALL' | 'GOOD' | 'SHORTAGE' | 'EXCESS' | 'WASTE';

interface SimulatedItem extends IntegratedItem {
  sim: {
    currentADS: number;
    targetStock: number;
    stockDays: number;
    simStatus: 'shortage' | 'excess' | 'good';
    isRisk: boolean;
    usableStock: number; // 현재 뷰 모드에 따른 가용 재고
    wasteStock: number;
    qualityStock: number;
    buckets: { 
        under50: number;
        r50_70: number;
        r70_75: number;
        r75_85: number;
        over85: number;
    };
    targetDatePlan: number;
  }
}

type AdsPeriod = 30 | 60 | 90;
type SortKey = 'name' | 'totalStock' | 'qualityStock' | 'bucket_under50' | 'bucket_50_70' | 'bucket_70_75' | 'bucket_75_85' | 'bucket_over85' | 'ads' | 'stockDays' | 'status' | 'future';
type SortDirection = 'asc' | 'desc';

export default function InventoryPage() {
  const { unitMode, inventoryViewMode } = useUiStore(); 
  const { endDate: storeEndDate } = useDateStore();

  const [adsPeriod, setAdsPeriod] = useState<AdsPeriod>(60);
  
  const today = new Date();
  const queryEndDate = format(subDays(today, 1), 'yyyy-MM-dd');
  const queryStartDate = format(subDays(today, adsPeriod), 'yyyy-MM-dd');

  const { data: rawData, isLoading } = useQuery<DashboardAnalysis>({
    queryKey: ['inventory-analysis', queryStartDate, queryEndDate], 
    queryFn: async () => {
      const res = await getDashboardData(queryStartDate, queryEndDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    staleTime: 1000 * 60 * 5, 
    refetchOnWindowFocus: false,
  });

  const data = rawData;

  const [targetDays, setTargetDays] = useState<number>(30); 
  const [minShelfRate, setMinShelfRate] = useState<number>(30); 
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const [includeQualityInSim, setIncludeQualityInSim] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('ALL');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'status', direction: 'asc' });

  const itemsPerPage = 15;

  const handlePeriodChange = (period: AdsPeriod) => {
    setAdsPeriod(period);
    setCurrentPage(1);
  };

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
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

  // ✅ [핵심 로직] 시뮬레이션 계산 시 View Mode 반영
  const simulation = useMemo(() => {
    if (!data) return { all: [], kpi: { good: 0, shortage: 0, excess: 0, risk: 0, totalWaste: 0, wasteCount: 0 } };

    const targetDate = storeEndDate;
    const productionMap = new Map<string, number>();
    data.productionList.forEach((row: ProductionRow) => {
        if (row.date === targetDate) {
            const current = productionMap.get(row.code) || 0;
            productionMap.set(row.code, current + row.planQty);
        }
    });

    let items = data.integratedArray.filter((item: IntegratedItem) => {
      // 해당 뷰 모드에 재고가 있는지 확인
      let hasStock = false;
      if (inventoryViewMode === 'PLANT') hasStock = item.inventory.plantStock > 0 || item.inventory.qualityStock > 0;
      else if (inventoryViewMode === 'LOGISTICS') hasStock = item.inventory.fbhStock > 0;
      else hasStock = item.inventory.totalStock > 0;

      const matchesSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return hasStock && matchesSearch;
    });

    const simulatedItems: SimulatedItem[] = items.map((item: IntegratedItem) => {
      const currentADS = item.inventory.ads || 0;
      
      // 1. 현재 뷰 모드에 맞는 배치를 선택
      let targetBatches: InventoryBatch[] = [];
      let totalViewStock = 0;

      if (inventoryViewMode === 'PLANT') {
          targetBatches = item.inventory.plantBatches;
          totalViewStock = item.inventory.plantStock;
      } else if (inventoryViewMode === 'LOGISTICS') {
          targetBatches = item.inventory.fbhBatches;
          totalViewStock = item.inventory.fbhStock;
      } else {
          targetBatches = item.inventory.batches;
          totalViewStock = item.inventory.totalStock;
      }

      // 2. 가용 재고 계산 (선택된 배치 중 기준 통과한 것만)
      let usableStock = targetBatches
        .filter(b => b.remainRate >= minShelfRate) 
        .reduce((sum, b) => sum + b.quantity, 0);

      // 품질 재고 포함 여부 (플랜트 모드이거나 통합 모드일 때만 유효)
      if (includeQualityInSim && inventoryViewMode !== 'LOGISTICS') {
        usableStock += item.inventory.qualityStock;
      }

      // 폐기(비가용) 재고 계산
      const wasteStock = totalViewStock - usableStock;

      const targetStock = Math.ceil(currentADS * targetDays);
      const stockDays = currentADS > 0 ? usableStock / currentADS : 999;

      let simStatus: 'shortage' | 'excess' | 'good' = 'good';
      if (stockDays < targetDays) simStatus = 'shortage';
      else if (stockDays > targetDays * 2) simStatus = 'excess';

      const targetDatePlan = productionMap.get(item.code) || 0;
      const isRisk = simStatus === 'shortage' && targetDatePlan === 0;

      // 3. 구간별 재고 (Buckets) - 선택된 배치 기준 재집계
      const buckets = { under50: 0, r50_70: 0, r70_75: 0, r75_85: 0, over85: 0 };
      targetBatches.forEach(b => {
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
            qualityStock: (inventoryViewMode !== 'LOGISTICS') ? item.inventory.qualityStock : 0,
            targetDatePlan 
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

    return { all: simulatedItems, kpi };
  }, [data, targetDays, minShelfRate, searchTerm, includeQualityInSim, storeEndDate, inventoryViewMode]); // 의존성 배열에 ViewMode 추가

  const filteredAndPaginated = useMemo(() => {
    let list = simulation.all || [];

    if (filterStatus === 'GOOD') list = list.filter(i => i.sim.simStatus === 'good');
    else if (filterStatus === 'SHORTAGE') list = list.filter(i => i.sim.simStatus === 'shortage');
    else if (filterStatus === 'EXCESS') list = list.filter(i => i.sim.simStatus === 'excess');
    else if (filterStatus === 'WASTE') list = list.filter(i => i.sim.wasteStock > 0);

    list.sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (sortConfig.key) {
        case 'name': valA = a.name; valB = b.name; break;
        case 'totalStock': valA = a.sim.usableStock + a.sim.wasteStock; valB = b.sim.usableStock + b.sim.wasteStock; break;
        case 'stockDays': valA = a.sim.stockDays; valB = b.sim.stockDays; break;
        case 'ads': valA = a.sim.currentADS; valB = b.sim.currentADS; break;
        // ... (나머지 정렬 케이스 동일) ...
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    const totalCount = list.length;
    const totalPages = Math.ceil(totalCount / itemsPerPage);
    const startIdx = (currentPage - 1) * itemsPerPage;
    const items = list.slice(startIdx, startIdx + itemsPerPage);

    return { items, totalPages, totalCount };
  }, [simulation.all, filterStatus, currentPage, sortConfig]);

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
            <span className={`text-[10px] px-2 py-0.5 rounded text-white font-bold ${inventoryViewMode==='ALL'?'bg-green-600':inventoryViewMode==='LOGISTICS'?'bg-purple-600':'bg-blue-600'}`}>
                현재 모드: {inventoryViewMode === 'ALL' ? '통합' : inventoryViewMode === 'LOGISTICS' ? '물류센터' : '플랜트'}
            </span>
          </p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-3 items-end md:items-center">
            <div className="flex items-center gap-2">
                {/* 물류센터 모드가 아닐 때만 품질재고 버튼 표시 */}
                {inventoryViewMode !== 'LOGISTICS' && (
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
                )}

                {showHiddenStock && inventoryViewMode !== 'LOGISTICS' && (
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

      {/* Controller & KPI Cards 생략 (기존과 동일하며 로직만 simulation 변수 사용) */}
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
        <SimulationKpi title="적정 (Good)" value={simulation.kpi.good} color="green" icon={CheckCircle} active={filterStatus === 'GOOD'} onClick={() => handleFilterClick('GOOD')} />
        <SimulationKpi title="부족 예상 (Short)" value={simulation.kpi.shortage} sub={`리스크: ${simulation.kpi.risk}건`} color="red" icon={AlertTriangle} active={filterStatus === 'SHORTAGE'} onClick={() => handleFilterClick('SHORTAGE')} />
        <SimulationKpi title="과잉 예상 (Excess)" value={simulation.kpi.excess} color="orange" icon={XCircle} active={filterStatus === 'EXCESS'} onClick={() => handleFilterClick('EXCESS')} />
        <SimulationKpi title={`가용불가(${minShelfRate}%미만)`} value={`${simulation.kpi.wasteCount}개 품목`} sub="" color="gray" icon={ShieldAlert} active={filterStatus === 'WASTE'} onClick={() => handleFilterClick('WASTE')} />
      </div>

      {/* Result Table */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span>📋 유효 재고 시뮬레이션 상세</span>
            {filterStatus !== 'ALL' && <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-white flex items-center gap-1"><Layers size={10} /> {filterStatus} 필터</span>}
          </div>
          <span className="text-[11px] font-normal text-neutral-500">단위: {unitMode === 'BOX' ? 'BOX (환산)' : '기준 (EA/KG)'}</span>
        </div>
        
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <SortableHeader label="제품명" sortKey="name" currentSort={sortConfig} onSort={handleSort} width="20%" />
                <SortableHeader label="상태" sortKey="status" currentSort={sortConfig} onSort={handleSort} align="center" />
                <SortableHeader label="보유일수" sortKey="stockDays" currentSort={sortConfig} onSort={handleSort} align="right" />
                <SortableHeader label={`ADS (${adsPeriod}일)`} sortKey="ads" currentSort={sortConfig} onSort={handleSort} align="right" />
                <SortableHeader label="생산계획(당일)" sortKey="future" currentSort={sortConfig} onSort={handleSort} align="center" />
                <SortableHeader label="총 재고" sortKey="totalStock" currentSort={sortConfig} onSort={handleSort} align="right" />
                {showHiddenStock && inventoryViewMode !== 'LOGISTICS' && (
                    <SortableHeader label="품질대기" sortKey="qualityStock" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-purple-50 text-purple-700" />
                )}
                <SortableHeader label="~50%" sortKey="bucket_under50" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#C62828] bg-red-50/30" />
                <SortableHeader label="50~70%" sortKey="bucket_50_70" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#E65100] bg-orange-50/30" />
                <SortableHeader label="70~75%" sortKey="bucket_70_75" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#F57F17] bg-yellow-50/50" />
                <SortableHeader label="75~85%" sortKey="bucket_75_85" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#1565C0] bg-blue-50/30" />
                <SortableHeader label="85%~" sortKey="bucket_over85" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#2E7D32] bg-green-50/30" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredAndPaginated.items.map((item: SimulatedItem) => {
                // 렌더링 시에는 이미 'sim' 필드 안에 해당 뷰 모드에 맞게 계산된 값들이 들어있음
                const dTotal = formatQty(item.sim.usableStock + item.sim.wasteStock, item.umrezBox, item.unit);
                const dAds = formatQty(item.sim.currentADS, item.umrezBox, item.unit, 0); 
                const dPlan = formatQty(item.sim.targetDatePlan, item.umrezBox, item.unit);
                const buckets = item.sim.buckets;
                const dQuality = formatQty(item.sim.qualityStock, item.umrezBox, item.unit);

                return (
                  <tr key={item.code} className={`hover:bg-[#F9F9F9] transition-colors h-[48px] ${item.sim.isRisk ? 'bg-[#FFF8F8]' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                    </td>
                    <td className="px-2 py-3 text-center"><SimulationBadge status={item.sim.simStatus} /></td>
                    <td className="px-2 py-3 text-right font-medium">
                      <span className={`${item.sim.simStatus === 'shortage' ? 'text-[#E53935] font-bold' : 'text-[#2E7D32]'}`}>
                        {item.sim.stockDays.toFixed(1)}일
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right text-neutral-600">{dAds.value}</td>
                    <td className="px-2 py-3 text-center">
                      {item.sim.targetDatePlan > 0 ? (
                        <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">{dPlan.value}</span>
                      ) : (
                        item.sim.isRisk ? <span className="px-2 py-1 rounded bg-[#FFEBEE] text-[#C62828] text-[11px] font-bold">⚠️ 계획없음</span> : <span className="text-neutral-300 text-[11px]">-</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-right font-bold text-neutral-800">{dTotal.value}</td>
                    {showHiddenStock && inventoryViewMode !== 'LOGISTICS' && (
                        <td className="px-2 py-3 text-right font-bold text-purple-700 bg-purple-50/30">
                            {item.inventory.qualityStock > 0 ? dQuality.value : '-'}
                        </td>
                    )}
                    <td className="px-2 py-3 text-right text-[#C62828] bg-red-50/30 font-medium">{buckets.under50 > 0 ? formatQty(buckets.under50, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#E65100] bg-orange-50/30 font-medium">{buckets.r50_70 > 0 ? formatQty(buckets.r50_70, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#F57F17] bg-yellow-50/50 font-medium">{buckets.r70_75 > 0 ? formatQty(buckets.r70_75, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#1565C0] bg-blue-50/30 font-medium">{buckets.r75_85 > 0 ? formatQty(buckets.r75_85, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#2E7D32] bg-green-50/30 font-medium">{buckets.over85 > 0 ? formatQty(buckets.over85, item.umrezBox, item.unit).value : '-'}</td>
                  </tr>
                );
              })}
              {filteredAndPaginated.items.length === 0 && <tr><td colSpan={12} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>}
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

// 나머지 헬퍼 컴포넌트(SortableHeader, SimulationKpi, SimulationBadge, LoadingSpinner, ErrorDisplay)는 기존과 동일하게 유지
function SortableHeader({ label, sortKey, currentSort, onSort, align = 'left', width, className = '' }: any) {
  const isActive = currentSort.key === sortKey;
  return (
    <th className={`px-2 py-3 border-b font-bold text-neutral-700 cursor-pointer select-none hover:bg-neutral-100 transition-colors ${className}`} style={{ textAlign: align, width }} onClick={() => onSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
        {label}
        {isActive ? (currentSort.direction === 'asc' ? <ArrowUp size={12} className="text-primary-blue"/> : <ArrowDown size={12} className="text-primary-blue"/>) : <ArrowUpDown size={12} className="text-neutral-300"/>}
      </div>
    </th>
  );
}
function SimulationKpi({ title, value, sub, color, icon: Icon, active, onClick }: any) {
  const styles: any = { blue: { base: "text-[#1565C0] bg-[#E3F2FD] border-[#BBDEFB]", active: "ring-2 ring-[#1565C0] ring-offset-2" }, green: { base: "text-[#2E7D32] bg-[#E8F5E9] border-[#C8E6C9]", active: "ring-2 ring-[#2E7D32] ring-offset-2 bg-[#C8E6C9]" }, red: { base: "text-[#C62828] bg-[#FFEBEE] border-[#FFCDD2]", active: "ring-2 ring-[#C62828] ring-offset-2 bg-[#FFCDD2]" }, orange: { base: "text-[#EF6C00] bg-[#FFF3E0] border-[#FFE0B2]", active: "ring-2 ring-[#EF6C00] ring-offset-2 bg-[#FFE0B2]" }, gray: { base: "text-[#616161] bg-[#F5F5F5] border-[#E0E0E0]", active: "ring-2 ring-[#616161] ring-offset-2 bg-[#E0E0E0]" }, };
  const s = styles[color] || styles.gray;
  return (
    <div onClick={onClick} className={`p-4 rounded border flex items-center justify-between shadow-sm cursor-pointer transition-all hover:-translate-y-1 ${s.base} ${active ? s.active : 'hover:opacity-90'}`}>
      <div><div className="text-[12px] font-bold opacity-80 uppercase mb-1">{title}</div><div className="text-2xl font-bold flex items-end gap-2">{value} {sub && <span className="text-[11px] font-medium opacity-80 pb-1">{sub}</span>}</div></div><Icon size={24} className="opacity-80" />
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