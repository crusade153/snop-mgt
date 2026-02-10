'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { IntegratedItem, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 
import * as XLSX from 'xlsx'; 
import { format } from 'date-fns';

type TabType = 'all' | 'healthy' | 'critical' | 'imminent' | 'disposed' | 'no_expiry';
type ViewMode = 'DAYS' | 'RATE'; 

export default function StockStatusPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode, inventoryViewMode } = useUiStore();

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('DAYS'); 
  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  const getStockInfo = (item: IntegratedItem) => {
    let targetStock = 0;
    let targetBatches: InventoryBatch[] = [];

    if (inventoryViewMode === 'PLANT') {
        targetStock = item.inventory.plantStock;
        targetBatches = item.inventory.plantBatches;
    } else if (inventoryViewMode === 'LOGISTICS') {
        targetStock = item.inventory.fbhStock;
        targetBatches = item.inventory.fbhBatches;
    } else { 
        targetStock = item.inventory.totalStock;
        targetBatches = item.inventory.batches;
    }
    return { targetStock, targetBatches };
  };

  const filteredData = useMemo(() => {
    if (!data) return [];
    
    let items = data.integratedArray;

    // 검색어 필터
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      items = items.filter((item: IntegratedItem) => 
        item.name.toLowerCase().includes(lower) || 
        item.code.includes(lower)
      );
    }

    // 재고 0 제외 필터 (품질재고 체크 포함)
    items = items.filter((item: IntegratedItem) => {
        const { targetStock } = getStockInfo(item);
        const qualityCheck = (inventoryViewMode === 'PLANT' && showHiddenStock && item.inventory.qualityStock > 0);
        return targetStock > 0 || qualityCheck;
    });
    
    // 탭 필터링 로직
    if (activeTab !== 'all') {
      items = items.filter((item: IntegratedItem) => {
        const { targetBatches } = getStockInfo(item);
        const isProductNoExpiry = item.code.startsWith('6');

        return targetBatches.some(b => {
            const isBatchNoExpiry = isProductNoExpiry || b.expirationDate === '-' || b.expirationDate === '';
            
            if (activeTab === 'no_expiry') {
                return isBatchNoExpiry;
            }

            if (isBatchNoExpiry) return false;

            const days = b.remainDays;
            let status = 'healthy';
            if (days <= 0) status = 'disposed';
            else if (days <= 30) status = 'imminent';
            else if (days <= 60) status = 'critical';
            
            return status === activeTab;
        });
      });
    }

    // 유통기한 임박 순 정렬
    items.sort((a, b) => {
        const { targetBatches: bA } = getStockInfo(a);
        const { targetBatches: bB } = getStockInfo(b);
        const minA = bA.length > 0 ? Math.min(...bA.map(bt => bt.remainDays)) : 9999;
        const minB = bB.length > 0 ? Math.min(...bB.map(bt => bt.remainDays)) : 9999;
        return minA - minB;
    });
    
    return items;
  }, [data, activeTab, searchTerm, viewMode, showHiddenStock, inventoryViewMode]);

  // 페이지네이션 로직 수정 (확실한 슬라이싱)
  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // 테이블 상단으로 스크롤 이동
    const tableTop = document.getElementById('stock-table-top');
    if (tableTop) tableTop.scrollIntoView({ behavior: 'smooth' });
  };

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

  const calculateRateBuckets = (batches: InventoryBatch[]) => {
    const buckets = { under50: 0, r50_70: 0, r70_75: 0, r75_85: 0, over85: 0 };
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

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <div className="p-10 text-center text-red-500">데이터를 불러오지 못했습니다.</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div id="stock-table-top" className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto max-w-full">
          <TabButton label="전체" count={filteredData.length} active={activeTab === 'all'} onClick={() => { setActiveTab('all'); setCurrentPage(1); }} />
          <TabButton label="양호" active={activeTab === 'healthy'} onClick={() => { setActiveTab('healthy'); setCurrentPage(1); }} color="text-[#1565C0]" />
          <TabButton label="긴급 (60일↓)" active={activeTab === 'critical'} onClick={() => { setActiveTab('critical'); setCurrentPage(1); }} color="text-[#F57F17]" />
          <TabButton label="임박 (30일↓)" active={activeTab === 'imminent'} onClick={() => { setActiveTab('imminent'); setCurrentPage(1); }} color="text-[#E65100]" />
          <TabButton label="폐기" active={activeTab === 'disposed'} onClick={() => { setActiveTab('disposed'); setCurrentPage(1); }} color="text-[#C62828]" />
          <TabButton label="기한없음" active={activeTab === 'no_expiry'} onClick={() => { setActiveTab('no_expiry'); setCurrentPage(1); }} color="text-neutral-600" />
        </div>
        <div className="relative w-full md:w-64">
          <input type="text" placeholder="제품명 또는 코드 검색..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue bg-white" />
          <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
        </div>
      </div>

      <div className="bg-white rounded shadow border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse table-fixed">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-24 text-center">상태</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-[25%]">제품명</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right w-32">
                  {inventoryViewMode === 'ALL' ? '통합 재고' : inventoryViewMode === 'LOGISTICS' ? '물류센터 재고' : '플랜트 재고'}
                </th>
                {inventoryViewMode === 'PLANT' && showHiddenStock && (
                    <th className="px-4 py-3 border-b border-neutral-200 font-bold text-purple-700 text-right w-28 bg-purple-50">품질대기</th>
                )}
                {viewMode === 'DAYS' ? (
                    <>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">단위</th>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">소비기한 (최단)</th>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">잔여일수</th>
                        <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">잔여율(최단)</th>
                    </>
                ) : (
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
                const { targetStock, targetBatches } = getStockInfo(item);
                const displayStock = formatQty(targetStock, item.umrezBox, item.unit);
                const qualityStockVal = (inventoryViewMode === 'PLANT' && showHiddenStock) ? (item.inventory.qualityStock || 0) : 0;
                const displayQuality = formatQty(qualityStockVal, item.umrezBox, item.unit);

                const worstBatch = targetBatches.sort((a, b) => a.remainDays - b.remainDays)[0];
                const expiryDate = worstBatch ? worstBatch.expirationDate : '-';
                const remainRate = worstBatch ? worstBatch.remainRate : 0;
                const remainDays = worstBatch ? worstBatch.remainDays : 0;
                const buckets = calculateRateBuckets(targetBatches);
                const unitLabel = displayStock.unit;

                const isProductNoExpiry = item.code.startsWith('6');
                const isNoExpiry = isProductNoExpiry || (worstBatch && (worstBatch.expirationDate === '-' || worstBatch.expirationDate === ''));
                
                let status = 'healthy';
                if (isNoExpiry) status = 'no_expiry';
                else if (worstBatch) {
                    if (remainDays <= 0) status = 'disposed';
                    else if (remainDays <= 30) status = 'imminent';
                    else if (remainDays <= 60) status = 'critical';
                }

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={status} /></td>
                    <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900 truncate" title={item.name}>{item.name}</div>
                        <div className="text-[11px] text-neutral-400 font-mono">{item.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-800 border-r border-neutral-100">
                      {displayStock.value} <span className="text-[10px] font-normal text-neutral-400">{unitLabel}</span>
                      {!showHiddenStock && qualityStockVal > 0 && inventoryViewMode === 'PLANT' && (
                        <div className="text-[9px] text-purple-500 mt-0.5 flex justify-end items-center gap-0.5 font-normal">+품질 {displayQuality.value}</div>
                      )}
                    </td>
                    {inventoryViewMode === 'PLANT' && showHiddenStock && (
                        <td className="px-4 py-3 text-right font-bold text-purple-700 bg-purple-50/30 border-r border-purple-100">{qualityStockVal > 0 ? displayQuality.value : '-'}</td>
                    )}
                    {viewMode === 'DAYS' ? (
                        <>
                            <td className="px-4 py-3 text-center text-neutral-500 text-xs">{item.unit}</td>
                            <td className="px-4 py-3 text-center text-neutral-600 font-mono text-xs">{isNoExpiry ? '-' : expiryDate}</td>
                            <td className={`px-4 py-3 text-right font-bold ${status==='disposed'?'text-[#C62828]':status==='no_expiry'?'text-neutral-400':'text-neutral-600'}`}>
                                {isNoExpiry ? '-' : (worstBatch ? `${remainDays}일` : '-')}
                            </td>
                            <td className="px-4 py-3 text-right">
                                {isNoExpiry ? <span className="text-neutral-400">-</span> : (worstBatch ? <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${remainRate < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>{remainRate.toFixed(1)}%</span> : '-')}
                            </td>
                        </>
                    ) : (
                        <>
                            <td className="px-2 py-3 text-right text-[#C62828] font-bold bg-red-50/30">{buckets.under50 > 0 ? formatQty(buckets.under50, item.umrezBox, item.unit).value : '-'}</td>
                            <td className="px-2 py-3 text-right text-[#E65100] font-medium bg-orange-50/30">{buckets.r50_70 > 0 ? formatQty(buckets.r50_70, item.umrezBox, item.unit).value : '-'}</td>
                            <td className="px-2 py-3 text-right text-[#F57F17] font-medium bg-yellow-50/30">{buckets.r70_75 > 0 ? formatQty(buckets.r70_75, item.umrezBox, item.unit).value : '-'}</td>
                            <td className="px-2 py-3 text-right text-[#1565C0] font-medium bg-blue-50/30">{buckets.r75_85 > 0 ? formatQty(buckets.r75_85, item.umrezBox, item.unit).value : '-'}</td>
                            <td className="px-2 py-3 text-right text-[#2E7D32] font-medium bg-green-50/30">{buckets.over85 > 0 ? formatQty(buckets.over85, item.umrezBox, item.unit).value : '-'}</td>
                        </>
                    )}
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (<tr><td colSpan={10} className="p-10 text-center text-neutral-400">데이터가 없습니다.</td></tr>)}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 컨트롤 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button 
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))} 
              disabled={currentPage === 1} 
              className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm font-bold text-neutral-600">
              {currentPage} / {totalPages}
            </span>
            <button 
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))} 
              disabled={currentPage === totalPages} 
              className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={20} />
            </button>
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
      {count !== undefined && <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-neutral-100' : 'bg-neutral-200'}`}>{count}</span>}
    </button>
  );
}
function StatusBadge({ status }: { status: string }) {
  const config: any = { 
      healthy: { bg: '#E3F2FD', text: '#1E88E5', label: '양호' }, 
      critical: { bg: '#FFF8E1', text: '#F57F17', label: '긴급' }, 
      imminent: { bg: '#FFF3E0', text: '#E65100', label: '임박' }, 
      disposed: { bg: '#FFEBEE', text: '#E53935', label: '폐기' },
      no_expiry: { bg: '#F5F5F5', text: '#757575', label: '기한없음' }
  };
  const c = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (<span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>);
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }