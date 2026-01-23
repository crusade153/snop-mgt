'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Search, Calendar, ChevronLeft, ChevronRight, Percent, Eye, EyeOff, Download, FileSpreadsheet } from 'lucide-react';
import { IntegratedItem, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 
import * as XLSX from 'xlsx'; // ✅ 엑셀 라이브러리 import
import { format } from 'date-fns';

type TabType = 'all' | 'healthy' | 'critical' | 'imminent' | 'disposed';
type ViewMode = 'DAYS' | 'RATE'; 

export default function StockStatusPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore(); 

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('DAYS'); 
  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 15;

  // 필터링 로직
  const filteredData = useMemo(() => {
    if (!data) return [];
    
    // 가용재고 또는 품질재고가 있는 항목 필터링
    let items = data.integratedArray.filter((item: IntegratedItem) => 
      item.inventory.totalStock > 0 || (showHiddenStock && item.inventory.qualityStock > 0)
    );
    
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

    if (viewMode === 'RATE') {
        items.sort((a, b) => {
            const minRateA = a.inventory.batches.length > 0 ? Math.min(...a.inventory.batches.map(bt => bt.remainRate)) : 999;
            const minRateB = b.inventory.batches.length > 0 ? Math.min(...b.inventory.batches.map(bt => bt.remainRate)) : 999;
            return minRateA - minRateB;
        });
    } else {
        items.sort((a: IntegratedItem, b: IntegratedItem) => a.inventory.remainingDays - b.inventory.remainingDays);
    }
    
    return items;
  }, [data, activeTab, searchTerm, viewMode, showHiddenStock]);

  const paginatedItems = useMemo(() => {
    const startIdx = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIdx, startIdx + itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  // Helper: 단위 변환 함수 (값만 리턴)
  const getConvertedQty = (val: number, conversion: number) => {
    if (unitMode === 'BOX') {
      return Number((val / (conversion > 0 ? conversion : 1)).toFixed(1));
    }
    return val;
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

  // ✅ [New] 엑셀 다운로드 핸들러
  const handleExcelDownload = () => {
    if (filteredData.length === 0) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }

    const todayStr = format(new Date(), 'yyyyMMdd_HHmmss');
    const unitLabel = unitMode === 'BOX' ? 'BOX' : 'EA/KG';

    // 1. 엑셀용 데이터 매핑
    const excelData = filteredData.map((item, idx) => {
      const umrez = item.umrezBox;
      const buckets = calculateRateBuckets(item.inventory.batches);
      const worstBatch = item.inventory.batches.sort((a, b) => a.remainDays - b.remainDays)[0];

      return {
        'No': idx + 1,
        '상태': item.inventory.status.toUpperCase(),
        '제품코드': item.code,
        '제품명': item.name,
        '단위기준': unitLabel,
        [`총 재고(${unitLabel})`]: getConvertedQty(item.inventory.totalStock, umrez),
        [`품질대기(${unitLabel})`]: getConvertedQty(item.inventory.qualityStock, umrez),
        '최단 유통기한': worstBatch ? worstBatch.expirationDate : '-',
        '잔여일수': item.inventory.remainingDays,
        '최저 잔여율(%)': worstBatch ? `${worstBatch.remainRate.toFixed(1)}%` : '-',
        [`잔여율 50%미만(${unitLabel})`]: getConvertedQty(buckets.under50, umrez),
        [`잔여율 50~70%(${unitLabel})`]: getConvertedQty(buckets.r50_70, umrez),
        [`잔여율 70~75%(${unitLabel})`]: getConvertedQty(buckets.r70_75, umrez),
        [`잔여율 75~85%(${unitLabel})`]: getConvertedQty(buckets.r75_85, umrez),
        [`잔여율 85%이상(${unitLabel})`]: getConvertedQty(buckets.over85, umrez),
      };
    });

    // 2. 워크시트 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // 3. 컬럼 너비 조정 (선택 사항)
    const wscols = [
      { wch: 5 },  // No
      { wch: 10 }, // 상태
      { wch: 12 }, // 제품코드
      { wch: 40 }, // 제품명
      { wch: 10 }, // 단위
      { wch: 15 }, // 총재고
      { wch: 15 }, // 품질대기
      { wch: 12 }, // 유통기한
      { wch: 10 }, // 잔여일수
      // 나머지 자동
    ];
    worksheet['!cols'] = wscols;

    // 4. 워크북 생성 및 파일 쓰기
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "재고현황");
    
    const fileName = `재고현황_${unitLabel}_${todayStr}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6">
      {/* Header Area */}
      <div className="pb-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
            <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            📦 재고 상세 현황 (Current Stock Status)
            </h1>
            <p className="text-[12px] text-neutral-700 mt-1">
            전체 재고의 유통기한 및 잔여율 집중 모니터링
            </p>
        </div>
        
        <div className="flex gap-2">
            {/* ✅ [New] 엑셀 다운로드 버튼 */}
            <button 
                onClick={handleExcelDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all bg-green-600 text-white hover:bg-green-700 shadow-sm"
                title="현재 필터링된 데이터를 엑셀로 다운로드합니다."
            >
                <FileSpreadsheet size={14}/> 엑셀 다운로드
            </button>

            <div className="w-[1px] h-8 bg-neutral-300 mx-1"></div>

            <button 
                onClick={() => setShowHiddenStock(!showHiddenStock)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all border ${
                showHiddenStock 
                    ? 'bg-purple-50 text-purple-700 border-purple-200' 
                    : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
                }`}
            >
                {showHiddenStock ? <EyeOff size={14}/> : <Eye size={14}/>}
                {showHiddenStock ? '품질재고 숨기기' : '숨은 재고(품질) 보기'}
            </button>

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
      </div>

      {/* Filter & Search */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto max-w-full">
          <TabButton label="전체" count={filteredData.length} active={activeTab === 'all'} onClick={() => { setActiveTab('all'); setCurrentPage(1); }} />
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

      {/* Table Area */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse table-fixed">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-24 text-center">상태</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-[25%]">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right w-32">
                  총 재고 (가용)
                </th>
                
                {showHiddenStock && (
                    <th className="px-4 py-3 border-b border-neutral-200 font-bold text-purple-700 text-right w-28 bg-purple-50">
                        품질대기
                    </th>
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
                const displayStock = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                const qualityStockVal = item.inventory.qualityStock || 0;
                const displayQuality = formatQty(qualityStockVal, item.umrezBox, item.unit);

                const worstBatch = item.inventory.batches.sort((a, b) => a.remainDays - b.remainDays)[0];
                const expiryDate = worstBatch ? worstBatch.expirationDate : '-';
                const remainRate = worstBatch ? worstBatch.remainRate : 0;
                const buckets = calculateRateBuckets(item.inventory.batches);
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
                      {!showHiddenStock && qualityStockVal > 0 && (
                        <div className="text-[9px] text-purple-500 mt-0.5 flex justify-end items-center gap-0.5 font-normal">
                          +품질 {displayQuality.value}
                        </div>
                      )}
                    </td>

                    {showHiddenStock && (
                        <td className="px-4 py-3 text-right font-bold text-purple-700 bg-purple-50/30 border-r border-purple-100">
                            {qualityStockVal > 0 ? displayQuality.value : '-'}
                        </td>
                    )}

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
                            <td className="px-2 py-3 text-right text-[#C62828] font-bold bg-red-50/30">
                                {buckets.under50 > 0 ? formatQty(buckets.under50, item.umrezBox, item.unit).value : '-'}
                            </td>
                            <td className="px-2 py-3 text-right text-[#E65100] font-medium bg-orange-50/30">
                                {buckets.r50_70 > 0 ? formatQty(buckets.r50_70, item.umrezBox, item.unit).value : '-'}
                            </td>
                            <td className="px-2 py-3 text-right text-[#F57F17] font-medium bg-yellow-50/30">
                                {buckets.r70_75 > 0 ? formatQty(buckets.r70_75, item.umrezBox, item.unit).value : '-'}
                            </td>
                            <td className="px-2 py-3 text-right text-[#1565C0] font-medium bg-blue-50/30">
                                {buckets.r75_85 > 0 ? formatQty(buckets.r75_85, item.umrezBox, item.unit).value : '-'}
                            </td>
                            <td className="px-2 py-3 text-right text-[#2E7D32] font-medium bg-green-50/30">
                                {buckets.over85 > 0 ? formatQty(buckets.over85, item.umrezBox, item.unit).value : '-'}
                            </td>
                        </>
                    )}
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (<tr><td colSpan={viewMode === 'DAYS' ? (showHiddenStock ? 9 : 8) : (showHiddenStock ? 10 : 9)} className="p-10 text-center text-neutral-400">검색된 재고가 없습니다.</td></tr>)}
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