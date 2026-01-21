'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Search, Calendar, ChevronLeft, ChevronRight, Layers, Percent } from 'lucide-react';
import { IntegratedItem, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 

type TabType = 'all' | 'healthy' | 'critical' | 'imminent' | 'disposed';
type ViewMode = 'DAYS' | 'RATE'; // 뷰 모드 타입 정의

export default function StockStatusPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore(); 

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('DAYS'); // 기본은 일수 기준(기존)
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // 필터링 로직
  const filteredData = useMemo(() => {
    if (!data) return [];
    let items = data.integratedArray.filter((item: IntegratedItem) => item.inventory.totalStock > 0);
    
    // 상태 탭 필터
    if (activeTab !== 'all') {
      items = items.filter((item: IntegratedItem) => item.inventory.status === activeTab);
    }
    
    // 검색어 필터
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      items = items.filter((item: IntegratedItem) => 
        item.name.toLowerCase().includes(lower) || 
        item.code.includes(lower)
      );
    }

    // 정렬: 잔여율 뷰일 때는 잔여율이 낮은 순(risk), 일수 뷰일 때는 일수 적은 순
    if (viewMode === 'RATE') {
        // 가장 낮은 잔여율을 가진 배치가 있는 순서대로 정렬
        items.sort((a, b) => {
            const minRateA = Math.min(...a.inventory.batches.map(bt => bt.remainRate));
            const minRateB = Math.min(...b.inventory.batches.map(bt => bt.remainRate));
            return minRateA - minRateB;
        });
    } else {
        items.sort((a: IntegratedItem, b: IntegratedItem) => a.inventory.remainingDays - b.inventory.remainingDays);
    }
    
    return items;
  }, [data, activeTab, searchTerm, viewMode]);

  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

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

  // Helper: 잔여율 구간별 수량 집계 함수
  const calculateRateBuckets = (batches: InventoryBatch[]) => {
    const buckets = {
        under50: 0,   // ~50%
        r50_70: 0,    // 50~70%
        r70_75: 0,    // 70~75%
        r75_85: 0,    // 75~85%
        over85: 0     // 85%~
    };

    batches.forEach(b => {
        const r = b.remainRate;
        if (r < 50) buckets.under50 += b.quantity;
        else if (r < 70) buckets.r50_70 += b.quantity;
        else if (r < 75) buckets.r70_75 += b.quantity;
        else if (r < 85) buckets.r75_85 += b.quantity;
        else buckets.over85 += b.quantity;
    });

    return buckets;
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-neutral-200 flex justify-between items-end">
        <div>
            <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            📦 재고 상세 현황 (Current Stock Status)
            </h1>
            <p className="text-[12px] text-neutral-700 mt-1">
            전체 재고의 유통기한 및 잔여율 집중 모니터링
            </p>
        </div>
        
        {/* 뷰 모드 전환 토글 */}
        <div className="flex bg-neutral-100 p-1 rounded-lg border border-neutral-200">
            <button 
                onClick={() => setViewMode('DAYS')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'DAYS' ? 'bg-white shadow text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
                <Calendar size={14}/> 유통기한 기준
            </button>
            <button 
                onClick={() => setViewMode('RATE')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'RATE' ? 'bg-white shadow text-blue-700' : 'text-neutral-500 hover:text-neutral-700'}`}
            >
                <Percent size={14}/> 잔여율 구간 기준
            </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto max-w-full">
          <TabButton label="전체" count={data.integratedArray.filter((i: IntegratedItem)=>i.inventory.totalStock>0).length} active={activeTab === 'all'} onClick={() => { setActiveTab('all'); setCurrentPage(1); }} />
          <TabButton label="양호" count={data.stockHealth.healthy} active={activeTab === 'healthy'} onClick={() => { setActiveTab('healthy'); setCurrentPage(1); }} color="text-[#1565C0]" />
          <TabButton label="긴급 (60일↓)" count={data.stockHealth.critical} active={activeTab === 'critical'} onClick={() => { setActiveTab('critical'); setCurrentPage(1); }} color="text-[#F57F17]" />
          <TabButton label="임박 (30일↓)" count={data.stockHealth.imminent} active={activeTab === 'imminent'} onClick={() => { setActiveTab('imminent'); setCurrentPage(1); }} color="text-[#E65100]" />
          <TabButton label="폐기" count={data.stockHealth.disposed} active={activeTab === 'disposed'} onClick={() => { setActiveTab('disposed'); setCurrentPage(1); }} color="text-[#C62828]" />
        </div>

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

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse table-fixed">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-24 text-center">상태</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-[25%]">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right w-24">
                  총 재고
                </th>
                
                {viewMode === 'DAYS' ? (
                    // 기존 유통기한 뷰 컬럼
                    <>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">단위</th>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">소비기한 (최단)</th>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">잔여일수</th>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">잔여율(최단)</th>
                    </>
                ) : (
                    // 신규 잔여율 구간 뷰 컬럼
                    <>
                        <th className="px-2 py-3 border-b border-neutral-200 font-bold text-[#C62828] text-right bg-red-50/50">50% 미만</th>
                        <th className="px-2 py-3 border-b border-neutral-200 font-bold text-[#E65100] text-right bg-orange-50/50">50~70%</th>
                        <th className="px-2 py-3 border-b border-neutral-200 font-bold text-[#F57F17] text-right bg-yellow-50/50">70~75%</th>
                        <th className="px-2 py-3 border-b border-neutral-200 font-bold text-[#1565C0] text-right bg-blue-50/50">75~85%</th>
                        <th className="px-2 py-3 border-b border-neutral-200 font-bold text-[#2E7D32] text-right bg-green-50/50">85% 이상</th>
                    </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedItems.map((item: IntegratedItem, idx: number) => {
                const displayStock = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                const worstBatch = item.inventory.batches.sort((a, b) => a.remainDays - b.remainDays)[0];
                const expiryDate = worstBatch ? worstBatch.expirationDate : '-';
                const remainRate = worstBatch ? worstBatch.remainRate : 0;
                
                // 잔여율 구간 계산
                const buckets = calculateRateBuckets(item.inventory.batches);

                // 단위 표시용 (구간별 숫자에 단위 붙이기 위함)
                const unitLabel = displayStock.unit;

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={item.inventory.status} /></td>
                    <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
                        <div className="text-[11px] text-neutral-400 font-mono">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-800 border-r border-neutral-100">
                      {displayStock.value} <span className="text-[10px] font-normal text-neutral-400">{unitLabel}</span>
                    </td>

                    {viewMode === 'DAYS' ? (
                        <>
                            <td className="px-4 py-3 text-center text-neutral-500 text-xs">{item.unit}</td>
                            <td className="px-4 py-3 text-center text-neutral-600 font-mono text-xs">{expiryDate}</td>
                            <td className={`px-4 py-3 text-right font-bold ${item.inventory.status !== 'healthy' ? 'text-[#C62828]' : 'text-neutral-600'}`}>
                                {item.inventory.remainingDays}일
                            </td>
                            <td className="px-4 py-3 text-right">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${remainRate < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>{remainRate.toFixed(1)}%</span>
                            </td>
                        </>
                    ) : (
                        <>
                            {/* 50% 미만 (위험) */}
                            <td className="px-2 py-3 text-right text-[#C62828] font-bold bg-red-50/30">
                                {buckets.under50 > 0 ? formatQty(buckets.under50, item.umrezBox, item.unit).value : '-'}
                            </td>
                            {/* 50~70% (주의) */}
                            <td className="px-2 py-3 text-right text-[#E65100] font-medium bg-orange-50/30">
                                {buckets.r50_70 > 0 ? formatQty(buckets.r50_70, item.umrezBox, item.unit).value : '-'}
                            </td>
                            {/* 70~75% (경계) */}
                            <td className="px-2 py-3 text-right text-[#F57F17] font-medium bg-yellow-50/30">
                                {buckets.r70_75 > 0 ? formatQty(buckets.r70_75, item.umrezBox, item.unit).value : '-'}
                            </td>
                            {/* 75~85% (안정) */}
                            <td className="px-2 py-3 text-right text-[#1565C0] font-medium bg-blue-50/30">
                                {buckets.r75_85 > 0 ? formatQty(buckets.r75_85, item.umrezBox, item.unit).value : '-'}
                            </td>
                            {/* 85% 이상 (최상) */}
                            <td className="px-2 py-3 text-right text-[#2E7D32] font-medium bg-green-50/30">
                                {buckets.over85 > 0 ? formatQty(buckets.over85, item.umrezBox, item.unit).value : '-'}
                            </td>
                        </>
                    )}
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (<tr><td colSpan={viewMode === 'DAYS' ? 8 : 9} className="p-10 text-center text-neutral-400">검색된 재고가 없습니다.</td></tr>)}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={20} /></button>
            <span className="text-sm font-bold text-neutral-600">{currentPage} / {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, count, active, onClick, color }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold transition-all whitespace-nowrap ${active ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'}`}>
      <span className={active && color ? color : ''}>{label}</span>
      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-neutral-100' : 'bg-neutral-200'}`}>{count}</span>
    </button>
  );
}
function StatusBadge({ status }: { status: string }) {
  const config: any = { healthy: { bg: '#E3F2FD', text: '#1E88E5', label: '양호' }, critical: { bg: '#FFF8E1', text: '#F57F17', label: '긴급' }, imminent: { bg: '#FFF3E0', text: '#E65100', label: '임박' }, disposed: { bg: '#FFEBEE', text: '#E53935', label: '폐기' }, };
  const c = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (<span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>);
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }