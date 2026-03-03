'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { IntegratedItem, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 

type TabType = 'all' | 'healthy' | 'critical' | 'imminent' | 'disposed' | 'no_expiry';

export default function StockStatusPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode, inventoryViewMode } = useUiStore();

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // 창고 뷰 모드에 따른 재고 타겟 설정
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

  // 배치별 상태를 계산하여 버킷(구간)별 수량을 집계
  const calculateStatusBuckets = (batches: InventoryBatch[]) => {
    const buckets = { healthy: 0, critical: 0, imminent: 0, disposed: 0, no_expiry: 0 };
    batches.forEach(b => {
        // 🚨 서버에서 넘어온 실제 날짜 유무만으로 상태를 판별합니다. (6번대 강제 예외 제거)
        const isBatchNoExpiry = !b.expirationDate || b.expirationDate === '-' || b.expirationDate === '' || b.expirationDate === '기한없음';
        if (isBatchNoExpiry) buckets.no_expiry += b.quantity;
        else if (b.remainDays <= 0) buckets.disposed += b.quantity;
        else if (b.remainDays <= 30) buckets.imminent += b.quantity;
        else if (b.remainDays <= 60) buckets.critical += b.quantity;
        else buckets.healthy += b.quantity;
    });
    return buckets;
  };

  const filteredData = useMemo(() => {
    if (!data) return [];
    
    let items = data.integratedArray;

    // 1. 텍스트 검색 필터
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      items = items.filter((item: IntegratedItem) => 
        item.name.toLowerCase().includes(lower) || 
        item.code.includes(lower)
      );
    }

    // 2. 재고가 있는 품목만 표시
    items = items.filter((item: IntegratedItem) => {
        const { targetStock } = getStockInfo(item);
        const qualityCheck = (inventoryViewMode === 'PLANT' && showHiddenStock && item.inventory.qualityStock > 0);
        return targetStock > 0 || qualityCheck;
    });
    
    // 3. 탭 클릭 시 해당 구간의 재고가 "존재하는" 품목만 남김
    if (activeTab !== 'all') {
      items = items.filter((item: IntegratedItem) => {
        const { targetBatches } = getStockInfo(item);
        if (targetBatches.length === 0) return false;
        
        // 🚨 프론트엔드의 6번대 하드코딩 완전 제거
        const buckets = calculateStatusBuckets(targetBatches);

        if (activeTab === 'no_expiry') return buckets.no_expiry > 0;
        if (activeTab === 'disposed') return buckets.disposed > 0;
        if (activeTab === 'imminent') return buckets.imminent > 0;
        if (activeTab === 'critical') return buckets.critical > 0;
        if (activeTab === 'healthy') return buckets.healthy > 0;
        
        return false;
      });
    }

    // 4. 정렬: 가장 안 좋은 소비기한(최단 잔여일)을 가진 순서대로 정렬
    items.sort((a, b) => {
        const { targetBatches: bA } = getStockInfo(a);
        const { targetBatches: bB } = getStockInfo(b);
        const minA = bA.length > 0 ? Math.min(...bA.map(bt => bt.remainDays)) : 9999;
        const minB = bB.length > 0 ? Math.min(...bB.map(bt => bt.remainDays)) : 9999;
        return minA - minB;
    });
    
    return items;
  }, [data, activeTab, searchTerm, showHiddenStock, inventoryViewMode]);

  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
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

  const getStockColumnTitle = () => {
    const prefix = inventoryViewMode === 'ALL' ? '통합 ' : inventoryViewMode === 'LOGISTICS' ? '물류 ' : '플랜트 ';
    if (activeTab === 'all') return `총 ${prefix}재고`;
    if (activeTab === 'healthy') return `양호 재고 (61일↑)`;
    if (activeTab === 'critical') return `긴급 재고 (31~60일)`;
    if (activeTab === 'imminent') return `임박 재고 (1~30일)`;
    if (activeTab === 'disposed') return `폐기 대상 재고`;
    if (activeTab === 'no_expiry') return `기한없음 재고`;
    return '재고 수량';
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <div className="p-10 text-center text-red-500">데이터를 불러오지 못했습니다.</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div id="stock-table-top" className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto max-w-full">
          <TabButton label="전체" count={filteredData.length} active={activeTab === 'all'} onClick={() => { setActiveTab('all'); setCurrentPage(1); }} />
          <TabButton label="양호 (61일↑)" active={activeTab === 'healthy'} onClick={() => { setActiveTab('healthy'); setCurrentPage(1); }} color="text-[#1565C0]" />
          <TabButton label="긴급 (31~60일)" active={activeTab === 'critical'} onClick={() => { setActiveTab('critical'); setCurrentPage(1); }} color="text-[#F57F17]" />
          <TabButton label="임박 (1~30일)" active={activeTab === 'imminent'} onClick={() => { setActiveTab('imminent'); setCurrentPage(1); }} color="text-[#E65100]" />
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
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-16 text-center">No</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-24 text-center">상태</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-[25%]">제품명</th>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-center w-16">단위</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-800 text-right w-36 bg-blue-50/40">
                  {getStockColumnTitle()}
                </th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center border-l border-neutral-200">소비기한 (최단)</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">잔여일수</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">잔여율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedItems.map((item: IntegratedItem, idx: number) => {
                const { targetStock, targetBatches } = getStockInfo(item);
                
                // 🚨 프론트엔드의 6번대 하드코딩 완전 제거 (isProductNoExpiry = false로 대체)
                const statusBuckets = calculateStatusBuckets(targetBatches);

                let displayStockValue = targetStock;
                if (activeTab === 'healthy') displayStockValue = statusBuckets.healthy;
                else if (activeTab === 'critical') displayStockValue = statusBuckets.critical;
                else if (activeTab === 'imminent') displayStockValue = statusBuckets.imminent;
                else if (activeTab === 'disposed') displayStockValue = statusBuckets.disposed;
                else if (activeTab === 'no_expiry') displayStockValue = statusBuckets.no_expiry;

                let badgeStatus = 'healthy';
                let batchesForDateCalc = targetBatches;

                if (activeTab === 'all') {
                    // 전체일 때는 가장 안좋은 상태 표시
                    if (statusBuckets.disposed > 0) badgeStatus = 'disposed';
                    else if (statusBuckets.imminent > 0) badgeStatus = 'imminent';
                    else if (statusBuckets.critical > 0) badgeStatus = 'critical';
                    else if (statusBuckets.no_expiry > 0 && targetStock === statusBuckets.no_expiry) badgeStatus = 'no_expiry';
                } else {
                    badgeStatus = activeTab;
                    batchesForDateCalc = targetBatches.filter(b => {
                        // 🚨 6번대 강제 예외 걷어내기
                        const isBatchNoExpiry = !b.expirationDate || b.expirationDate === '-' || b.expirationDate === '' || b.expirationDate === '기한없음';
                        if (activeTab === 'no_expiry') return isBatchNoExpiry;
                        if (isBatchNoExpiry) return false;
                        if (activeTab === 'disposed') return b.remainDays <= 0;
                        if (activeTab === 'imminent') return b.remainDays > 0 && b.remainDays <= 30;
                        if (activeTab === 'critical') return b.remainDays > 30 && b.remainDays <= 60;
                        if (activeTab === 'healthy') return b.remainDays > 60;
                        return false;
                    });
                }

                const displayStock = formatQty(displayStockValue, item.umrezBox, item.unit);

                // 화면에 표시할 최단 소비기한
                const worstBatch = batchesForDateCalc.sort((a, b) => a.remainDays - b.remainDays)[0];
                const showNoDate = !worstBatch || (!worstBatch.expirationDate || worstBatch.expirationDate === '-' || worstBatch.expirationDate === '' || worstBatch.expirationDate === '기한없음');

                const expiryDateStr = showNoDate ? '-' : worstBatch.expirationDate;
                const remainDaysStr = showNoDate ? '-' : `${worstBatch.remainDays}일`;
                const remainRateNum = showNoDate ? null : worstBatch.remainRate;

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[52px]">
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    
                    <td className="px-4 py-3 text-center">
                        <StatusBadge status={badgeStatus} />
                    </td>
                    
                    <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900 line-clamp-2" title={item.name}>{item.name}</div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-0.5">{item.code}</div>
                    </td>
                    
                    <td className="px-2 py-3 text-center text-neutral-500 text-xs">{item.unit}</td>
                    
                    <td className="px-4 py-3 text-right font-bold text-neutral-900 text-base bg-blue-50/20">
                      {displayStock.value} <span className="text-[10px] font-normal text-neutral-500 ml-1">{displayStock.unit}</span>
                    </td>
                    
                    <td className="px-4 py-3 text-center text-neutral-600 font-mono text-sm border-l border-neutral-200">
                        {expiryDateStr}
                    </td>
                    
                    <td className={`px-4 py-3 text-right font-bold text-sm ${badgeStatus === 'disposed' ? 'text-[#C62828]' : showNoDate ? 'text-neutral-400' : 'text-neutral-700'}`}>
                        {remainDaysStr}
                    </td>
                    
                    <td className="px-4 py-3 text-right">
                        {remainRateNum === null ? <span className="text-neutral-400">-</span> : (
                            <span className={`px-2 py-1 rounded text-[11px] font-bold ${remainRateNum < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>
                                {remainRateNum.toFixed(1)}%
                            </span>
                        )}
                    </td>
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (<tr><td colSpan={8} className="p-10 text-center text-neutral-500 font-medium">선택한 구간에 해당하는 재고 데이터가 없습니다.</td></tr>)}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronLeft size={20} /></button>
            <span className="text-sm font-bold text-neutral-600">{currentPage} / {totalPages}</span>
            <button onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, count, active, onClick, color }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold transition-all whitespace-nowrap ${active ? 'bg-white shadow-sm text-neutral-900 border border-neutral-200/50' : 'text-neutral-500 hover:text-neutral-700'}`}>
      <span className={active && color ? color : ''}>{label}</span>
      {count !== undefined && <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-200'}`}>{count}</span>}
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
  return (<span className="px-2.5 py-1 rounded text-xs font-bold border border-transparent" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>);
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }