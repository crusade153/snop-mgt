'use client'

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query'; 
import { getDashboardData } from '@/actions/dashboard-actions'; 
import { 
  Search, Eye, EyeOff, ArrowUp, ArrowDown, ArrowUpDown, CheckSquare, Square, BarChart3,
  ChevronLeft, ChevronRight, Clock
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { IntegratedItem, DashboardAnalysis, ProductionRow, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 
import { useDateStore } from '@/store/date-store';

// 필터 타입
type FilterStatus = 'ALL' | 'GOOD' | 'SHORTAGE' | 'EXCESS' | 'WASTE';

// 테이블 표출용 데이터 인터페이스
interface SimulatedItem extends IntegratedItem {
  sim: {
    ads30: number;
    ads60: number;
    ads90: number;
    
    usableStock: number; 
    wasteStock: number;
    qualityStock: number;
    
    // ✅ [추가] 회전일수 (가용재고 / ADS90)
    turnoverDays: number; 

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

// 정렬 키 (turnoverDays 추가됨)
type SortKey = 'name' | 'totalStock' | 'qualityStock' | 'turnoverDays' | 'bucket_under50' | 'bucket_50_70' | 'bucket_70_75' | 'bucket_75_85' | 'bucket_over85' | 'ads30' | 'ads60' | 'ads90' | 'future';
type SortDirection = 'asc' | 'desc';

export default function InventoryPage() {
  const { unitMode, inventoryViewMode } = useUiStore(); 
  const { endDate: storeEndDate } = useDateStore();

  const today = new Date();
  const queryEndDate = format(subDays(today, 1), 'yyyy-MM-dd');
  const queryStartDate = format(subDays(today, 90), 'yyyy-MM-dd');

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

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const [includeQualityInSim, setIncludeQualityInSim] = useState(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'totalStock', direction: 'desc' });

  const itemsPerPage = 15;

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

  const simulation = useMemo(() => {
    if (!data) return { all: [], adsSummary: { totalAds30: 0, totalAds60: 0, totalAds90: 0 } };

    const targetDate = storeEndDate;
    const productionMap = new Map<string, number>();
    
    data.productionList.forEach((row: ProductionRow) => {
        if (row.date === targetDate) {
            const current = productionMap.get(row.code) || 0;
            productionMap.set(row.code, current + row.planQty);
        }
    });

    let items = data.integratedArray.filter((item: IntegratedItem) => {
      let hasStock = false;
      if (inventoryViewMode === 'PLANT') hasStock = item.inventory.plantStock > 0 || item.inventory.qualityStock > 0;
      else if (inventoryViewMode === 'LOGISTICS') hasStock = item.inventory.fbhStock > 0;
      else hasStock = item.inventory.totalStock > 0;

      const matchesSearch = searchTerm === '' || 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.code.includes(searchTerm);
      return hasStock && matchesSearch;
    });

    let totalAds30 = 0;
    let totalAds60 = 0;
    let totalAds90 = 0;

    const simulatedItems: SimulatedItem[] = items.map((item: IntegratedItem) => {
      const ads30 = item.inventory.ads30 || 0;
      const ads60 = item.inventory.ads60 || 0;
      const ads90 = item.inventory.ads90 || 0;
      
      totalAds30 += ads30;
      totalAds60 += ads60;
      totalAds90 += ads90;
      
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

      const minShelfRate = 30;
      let usableStock = targetBatches
        .filter(b => b.remainRate >= minShelfRate) 
        .reduce((sum, b) => sum + b.quantity, 0);

      if (includeQualityInSim && inventoryViewMode !== 'LOGISTICS') {
        usableStock += item.inventory.qualityStock;
      }

      const wasteStock = totalViewStock - usableStock;
      const targetDatePlan = productionMap.get(item.code) || 0;

      // ✅ [추가] 회전일수 계산 (가용재고 / ADS90)
      // ADS가 0인 경우 Infinity가 되므로 정렬을 위해 99999로 처리하거나 0으로 처리 (여기선 0으로 처리하고 표출시 예외처리)
      const turnoverDays = ads90 > 0 ? usableStock / ads90 : (usableStock > 0 ? 99999 : 0);

      const buckets = { under50: 0, r50_70: 0, r70_75: 0, r75_85: 0, over85: 0 };
      targetBatches.forEach(b => {
          const r = b.remainRate;
          const days = b.remainDays; 

          if (days > 0) {
            if (r < 50) buckets.under50 += b.quantity;
            else if (r < 70) buckets.r50_70 += b.quantity;
            else if (r < 75) buckets.r70_75 += b.quantity;
            else if (r < 85) buckets.r75_85 += b.quantity;
            else buckets.over85 += b.quantity;
          }
      });

      return {
        ...item,
        sim: { 
            ads30, ads60, ads90,
            usableStock, wasteStock, buckets,
            qualityStock: (inventoryViewMode !== 'LOGISTICS') ? item.inventory.qualityStock : 0,
            turnoverDays, // 추가된 필드
            targetDatePlan
        }
      };
    });

    return { all: simulatedItems, adsSummary: { totalAds30, totalAds60, totalAds90 } };
  }, [data, searchTerm, includeQualityInSim, storeEndDate, inventoryViewMode]); 

  const filteredAndPaginated = useMemo(() => {
    let list = simulation.all || [];

    list.sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (sortConfig.key) {
        case 'name': valA = a.name; valB = b.name; break;
        case 'totalStock': valA = a.sim.usableStock + a.sim.wasteStock; valB = b.sim.usableStock + b.sim.wasteStock; break;
        // ✅ [수정] 버그 해결: 품질재고 정렬 케이스 추가
        case 'qualityStock': valA = a.sim.qualityStock; valB = b.sim.qualityStock; break;
        // ✅ [추가] 회전일 정렬 케이스 추가
        case 'turnoverDays': valA = a.sim.turnoverDays; valB = b.sim.turnoverDays; break;
        case 'ads30': valA = a.sim.ads30; valB = b.sim.ads30; break;
        case 'ads60': valA = a.sim.ads60; valB = b.sim.ads60; break;
        case 'ads90': valA = a.sim.ads90; valB = b.sim.ads90; break;
        case 'future': valA = a.sim.targetDatePlan; valB = b.sim.targetDatePlan; break;
        case 'bucket_under50': valA = a.sim.buckets.under50; valB = b.sim.buckets.under50; break;
        case 'bucket_50_70': valA = a.sim.buckets.r50_70; valB = b.sim.buckets.r50_70; break;
        case 'bucket_70_75': valA = a.sim.buckets.r70_75; valB = b.sim.buckets.r70_75; break;
        case 'bucket_75_85': valA = a.sim.buckets.r75_85; valB = b.sim.buckets.r75_85; break;
        case 'bucket_over85': valA = a.sim.buckets.over85; valB = b.sim.buckets.over85; break;
        default: valA = 0; valB = 0; 
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
  }, [simulation.all, currentPage, sortConfig]);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="pb-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            📦 재고 분석 리포트 (ADS Analysis)
          </h1>
          <p className="text-[12px] text-neutral-700 mt-1 flex items-center gap-2">
            <span>기간별 판매속도(ADS) 및 잔여율별 재고 분포</span>
            <span className={`text-[10px] px-2 py-0.5 rounded text-white font-bold ${inventoryViewMode==='ALL'?'bg-green-600':inventoryViewMode==='LOGISTICS'?'bg-purple-600':'bg-blue-600'}`}>
                현재 모드: {inventoryViewMode === 'ALL' ? '통합' : inventoryViewMode === 'LOGISTICS' ? '물류센터' : '플랜트'}
            </span>
          </p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-3 items-end md:items-center">
            <div className="flex items-center gap-2">
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
                        title="품질 대기 재고를 가용 재고에 포함하여 분석합니다."
                    >
                        {includeQualityInSim ? <CheckSquare size={14}/> : <Square size={14}/>}
                        가용재고 합산
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AdsReportBox label="최근 30일 평균 판매 (Total ADS)" value={simulation.adsSummary.totalAds30} unitMode={unitMode} />
        <AdsReportBox label="최근 60일 평균 판매 (Total ADS)" value={simulation.adsSummary.totalAds60} unitMode={unitMode} />
        <AdsReportBox label="최근 90일 평균 판매 (Total ADS)" value={simulation.adsSummary.totalAds90} unitMode={unitMode} />
      </div>

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span>📋 재고 및 ADS 상세 현황</span>
          </div>
          <span className="text-[11px] font-normal text-neutral-500">단위: {unitMode === 'BOX' ? 'BOX (환산)' : '기준 (EA/KG)'}</span>
        </div>
        
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <SortableHeader label="제품명" sortKey="name" currentSort={sortConfig} onSort={handleSort} width="22%" />
                <SortableHeader label="ADS(30)" sortKey="ads30" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-blue-50/20" />
                <SortableHeader label="ADS(60)" sortKey="ads60" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-blue-50/40" />
                <SortableHeader label="ADS(90)" sortKey="ads90" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-blue-50/60" />
                <SortableHeader label="생산계획(당일)" sortKey="future" currentSort={sortConfig} onSort={handleSort} align="center" />
                
                {showHiddenStock && inventoryViewMode !== 'LOGISTICS' && (
                    <SortableHeader label="품질재고" sortKey="qualityStock" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-purple-50 text-purple-700" />
                )}
                
                <SortableHeader label="가용재고" sortKey="totalStock" currentSort={sortConfig} onSort={handleSort} align="right" />
                
                {/* ✅ [추가] 회전일 컬럼 */}
                <SortableHeader label="회전일(90)" sortKey="turnoverDays" currentSort={sortConfig} onSort={handleSort} align="right" className="text-red-700 bg-red-50/10" />

                <SortableHeader label="~50% (유효)" sortKey="bucket_under50" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#C62828] bg-red-50/30" />
                <SortableHeader label="50~70%" sortKey="bucket_50_70" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#E65100] bg-orange-50/30" />
                <SortableHeader label="70~75%" sortKey="bucket_70_75" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#F57F17] bg-yellow-50/50" />
                <SortableHeader label="75~85%" sortKey="bucket_75_85" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#1565C0] bg-blue-50/30" />
                <SortableHeader label="85%~" sortKey="bucket_over85" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#2E7D32] bg-green-50/30" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filteredAndPaginated.items.map((item: SimulatedItem) => {
                const dTotal = formatQty(item.sim.usableStock + item.sim.wasteStock, item.umrezBox, item.unit);
                const dPlan = formatQty(item.sim.targetDatePlan, item.umrezBox, item.unit);
                const buckets = item.sim.buckets;
                const dQuality = formatQty(item.sim.qualityStock, item.umrezBox, item.unit);
                const dAds30 = formatQty(item.sim.ads30, item.umrezBox, item.unit, 0);
                const dAds60 = formatQty(item.sim.ads60, item.umrezBox, item.unit, 0);
                const dAds90 = formatQty(item.sim.ads90, item.umrezBox, item.unit, 0);

                // ✅ [로직] 회전일수 표기 (ADS90 기준)
                // item.sim.turnoverDays는 이미 계산되어 있음
                let displayTurnover = "-";
                if (item.sim.ads90 > 0 && item.sim.turnoverDays < 90000) {
                    const days = Math.round(item.sim.turnoverDays);
                    const months = (item.sim.turnoverDays / 30).toFixed(1);
                    displayTurnover = `${days}일 (${months}개월)`;
                }

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                    </td>
                    <td className="px-2 py-3 text-right text-neutral-600 bg-blue-50/20">{dAds30.value}</td>
                    <td className="px-2 py-3 text-right text-neutral-800 font-medium bg-blue-50/40">{dAds60.value}</td>
                    <td className="px-2 py-3 text-right text-neutral-600 bg-blue-50/60">{dAds90.value}</td>
                    <td className="px-2 py-3 text-center">
                      {item.sim.targetDatePlan > 0 ? (
                        <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">{dPlan.value}</span>
                      ) : (
                        <span className="text-neutral-300 text-[11px]">-</span>
                      )}
                    </td>
                    {showHiddenStock && inventoryViewMode !== 'LOGISTICS' && (
                        <td className="px-2 py-3 text-right font-bold text-purple-700 bg-purple-50/30">
                            {item.inventory.qualityStock > 0 ? dQuality.value : '-'}
                        </td>
                    )}
                    <td className="px-2 py-3 text-right font-bold text-neutral-800">{dTotal.value}</td>
                    
                    {/* ✅ [추가] 회전일 컬럼 (데이터 표시) */}
                    <td className="px-2 py-3 text-right text-red-700 font-bold bg-red-50/10 text-xs">
                        {displayTurnover}
                    </td>

                    <td className="px-2 py-3 text-right text-[#C62828] bg-red-50/30 font-medium">{buckets.under50 > 0 ? formatQty(buckets.under50, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#E65100] bg-orange-50/30 font-medium">{buckets.r50_70 > 0 ? formatQty(buckets.r50_70, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#F57F17] bg-yellow-50/50 font-medium">{buckets.r70_75 > 0 ? formatQty(buckets.r70_75, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#1565C0] bg-blue-50/30 font-medium">{buckets.r75_85 > 0 ? formatQty(buckets.r75_85, item.umrezBox, item.unit).value : '-'}</td>
                    <td className="px-2 py-3 text-right text-[#2E7D32] bg-green-50/30 font-medium">{buckets.over85 > 0 ? formatQty(buckets.over85, item.umrezBox, item.unit).value : '-'}</td>
                  </tr>
                );
              })}
              {filteredAndPaginated.items.length === 0 && <tr><td colSpan={15} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>}
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

function AdsReportBox({ label, value, unitMode }: any) {
  const displayVal = unitMode === 'BOX' ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : Math.round(value).toLocaleString();
  const unit = unitMode === 'BOX' ? 'BOX' : 'EA/KG';

  return (
    <div className="p-4 rounded border flex items-center justify-between shadow-sm bg-white border-neutral-200">
      <div>
        <div className="text-[12px] font-bold opacity-80 uppercase mb-1 text-neutral-500">{label}</div>
        <div className="text-2xl font-bold text-neutral-900">{displayVal} <span className="text-sm font-normal text-neutral-400">{unit}</span></div>
      </div>
      <BarChart3 size={24} className="opacity-20 text-neutral-500" />
    </div>
  );
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }