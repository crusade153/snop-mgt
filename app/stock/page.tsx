// app/stock/page.tsx
'use client'

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Search, ChevronLeft, ChevronRight, Download, Share2, Star } from 'lucide-react';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useKoreanInput } from '@/hooks/use-korean-input';
import { IntegratedItem, InventoryBatch } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store';
import { useFavorites } from '@/hooks/use-favorites';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import InventoryClassificationFilter from '@/components/inventory-classification-filter';
import {
  getProductionLine,
  INVENTORY_STOCK_TYPE_LABELS,
  InventoryStockType,
  InventoryStockTypeFilter,
} from '@/lib/inventory-classification';
import { classifyInventoryStatus, isNoExpiry } from '@/lib/inventory-status';
import type { PriceSource } from '@/lib/ending-inventory-price';
import { Coins, Factory, Layers, Wallet } from 'lucide-react';

type TabType = 'all' | 'healthy' | 'critical' | 'imminent' | 'disposed' | 'no_expiry';

// 🚨 제품 단위가 아닌 '배치(소비기한)' 단위의 데이터 타입 정의
interface BatchRow extends IntegratedItem {
  batchQty: number;
  expirationDateStr: string;
  remainDaysNum: number | '-';
  remainRateNum: number | null;
  status: string;
  isQuality: boolean;
  location: string; // ✅ 위치정보(LGOBE) 추가
  stockType: InventoryStockType;
  dispo?: string;
  productionLine: string | null;
  stockValue: number;
  priceSource: PriceSource;
}

function StockStatusPageInner() {
  const { data, isLoading } = useDashboardData();
  const { unitMode, inventoryViewMode, favoritesOnly } = useUiStore();
  const { getParam, getIntParam, setParams, copyShareUrl } = useUrlFilters();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();

  const activeTab = (getParam('tab', 'all') || 'all') as TabType;
  const searchTerm = getParam('search', '');
  const currentPage = getIntParam('page', 1);
  const stockType = (getParam('stockType', 'ALL') || 'ALL') as InventoryStockTypeFilter;
  const productionLine = getParam('line', 'ALL') || 'ALL';

  const setActiveTab = (v: TabType) => setParams({ tab: v !== 'all' ? v : null, page: null });
  const setSearchTerm = (v: string) => setParams({ search: v || null, page: null });
  const setCurrentPage = (p: number) => setParams({ page: p > 1 ? String(p) : null });
  const setStockType = (value: InventoryStockTypeFilter) => setParams({
    stockType: value === 'ALL' ? null : value,
    page: null,
  });
  const setProductionLine = (value: string) => setParams({
    line: value === 'ALL' ? null : value,
    page: null,
  });
  const searchInputProps = useKoreanInput(searchTerm, setSearchTerm);

  const [showHiddenStock, setShowHiddenStock] = useState(false);
  const itemsPerPage = 15;

  // 1. 데이터를 소비기한(배치)별로 각각의 행으로 분리(Flatten)
  const flattenedData = useMemo(() => {
    if (!data) return [];
    const rows: BatchRow[] = [];

    data.integratedArray.forEach((item: IntegratedItem) => {
        let targetBatches: InventoryBatch[] = [];
        let qualityStock = 0;

        // 뷰 모드에 따른 대상 데이터 선택
        if (inventoryViewMode === 'PLANT') {
            targetBatches = item.inventory.plantBatches || [];
            qualityStock = item.inventory.qualityStock || 0;
        } else if (inventoryViewMode === 'LOGISTICS') {
            targetBatches = item.inventory.fbhBatches || [];
        } else { 
            targetBatches = item.inventory.batches || [];
        }

        // 배치 단위별로 개별 Row 생성
        targetBatches.forEach(b => {
            if (b.quantity <= 0) return;

            // 판정 기준은 lib/inventory-status.ts 한 곳에만 둔다 (MCP 툴과 동일 기준 유지)
            const noExpiry = isNoExpiry(b.expirationDate);
            const status: string = classifyInventoryStatus(b.expirationDate, b.remainDays);

            // ✅ 백엔드에서 넘어오는 lgobe 속성을 매핑 (대소문자 방어 코드 포함)
            const lgobeValue = (b as any).LGOBE || (b as any).lgobe || (b as any).location || '-';

            rows.push({
                ...item,
                batchQty: b.quantity,
                expirationDateStr: noExpiry ? '-' : b.expirationDate,
                remainDaysNum: noExpiry ? '-' : b.remainDays,
                remainRateNum: noExpiry ? null : b.remainRate,
                status: status,
                isQuality: false,
                location: lgobeValue,
                stockType: b.stockType,
                dispo: b.dispo,
                productionLine: b.productionLine,
                stockValue: b.stockValue,
                priceSource: b.priceSource,
            });
        });

        // 품질대기 재고 옵션이 켜져있을 경우 별도의 행으로 추가
        if (inventoryViewMode === 'PLANT' && showHiddenStock && qualityStock > 0) {
            rows.push({
                ...item,
                batchQty: qualityStock,
                expirationDateStr: '-',
                remainDaysNum: '-',
                remainRateNum: null,
                status: 'quality_hold',
                isQuality: true,
                location: '품질대기',
                stockType: item.inventory.stockTypes[0] || 'OTHER',
                dispo: item.inventory.dispoCodes[0],
                productionLine: getProductionLine(item.inventory.dispoCodes[0]),
                stockValue: item.inventory.qualityStockValue,
                priceSource: item.inventory.priceSource,
            });
        }
    });

    return rows;
  }, [data, inventoryViewMode, showHiddenStock]);

  // 2. 검색, 탭 필터링 및 정렬 적용
  const filteredData = useMemo(() => {
    let items = flattenedData;

    // 즐겨찾기 필터
    if (favoritesOnly) {
      items = items.filter((row: BatchRow) => isFavorite(row.code));
    }

    // 텍스트 검색 필터
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      items = items.filter((row: BatchRow) =>
        row.name.toLowerCase().includes(lower) ||
        row.code.includes(lower)
      );
    }

    // 탭 클릭 필터
    if (activeTab !== 'all') {
      items = items.filter((row: BatchRow) => row.status === activeTab);
    }

    if (stockType !== 'ALL') {
      items = items.filter((row: BatchRow) => row.stockType === stockType);
    }

    if (productionLine !== 'ALL') {
      items = items.filter((row: BatchRow) => row.dispo === productionLine);
    }

    // 정렬: 가장 안 좋은 소비기한(최단 잔여일)을 가진 순서대로 정렬 후 제품코드 정렬
    items.sort((a, b) => {
        const aDays = a.remainDaysNum === '-' ? 99999 : a.remainDaysNum;
        const bDays = b.remainDaysNum === '-' ? 99999 : b.remainDaysNum;
        if (aDays !== bDays) return aDays - bDays;
        return a.code.localeCompare(b.code);
    });
    
    return items;
  }, [flattenedData, activeTab, searchTerm, favoritesOnly, isFavorite, stockType, productionLine]);

  // 3. 금액 요약 — 페이지네이션 이전의 filteredData 를 쓰므로 탭·검색·재고구분·라인·즐겨찾기 필터가 그대로 반영된다.
  const valueSummary = useMemo(() => {
    const pricedCodes = new Set<string>();
    const currentMonthCodes = new Set<string>();
    const allCodes = new Set<string>();
    let totalValue = 0;
    let riskValue = 0;

    filteredData.forEach((row) => {
      allCodes.add(row.code);

      if (row.priceSource === 'ENDING_INVENTORY') {
        pricedCodes.add(row.code);
        totalValue += row.stockValue;
        if (row.status === 'disposed' || row.status === 'imminent') riskValue += row.stockValue;
      } else if (row.priceSource === 'CURRENT_MONTH') {
        currentMonthCodes.add(row.code);
      }
    });

    return {
      totalValue,
      riskValue,
      itemCount: allCodes.size,
      rowCount: filteredData.length,
      pricedItemCount: pricedCodes.size,
      currentMonthItemCount: currentMonthCodes.size,
    };
  }, [filteredData]);

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
        unit: 'BOX',
        rawValue: Number(boxes.toFixed(1))
      };
    }
    return { value: val.toLocaleString(), unit: baseUnit, rawValue: val };
  };

  const getStockColumnTitle = () => {
    const prefix = inventoryViewMode === 'ALL' ? '통합 ' : inventoryViewMode === 'LOGISTICS' ? '물류 ' : '플랜트 ';
    if (activeTab === 'all') return `${prefix}재고`;
    if (activeTab === 'healthy') return `양호 재고 (61일↑)`;
    if (activeTab === 'critical') return `긴급 재고 (31~60일)`;
    if (activeTab === 'imminent') return `임박 재고 (1~30일)`;
    if (activeTab === 'disposed') return `폐기 대상 재고`;
    if (activeTab === 'no_expiry') return `기한없음 재고`;
    return '재고 수량';
  };

  const getStatusLabel = (status: string) => {
    const config: any = { 
        healthy: '양호', 
        critical: '긴급', 
        imminent: '임박', 
        disposed: '폐기',
        no_expiry: '기한없음',
        quality_hold: '품질대기'
    };
    return config[status] || status;
  };

  // 엑셀 다운로드 핸들러
  const handleDownloadExcel = () => {
    const excelData = filteredData.map((row, idx) => {
      const displayStock = formatQty(row.batchQty, row.umrezBox, row.unit);

      const rowData: any = {
        'No': idx + 1,
        '상태': getStatusLabel(row.status),
        '제품명': row.name,
        '코드': row.code,
        '재고구분': INVENTORY_STOCK_TYPE_LABELS[row.stockType],
        'DISPO': row.dispo || '',
        '생산라인': row.productionLine || '',
        '단위': row.unit,
        [getStockColumnTitle()]: displayStock.rawValue,
        '재고금액(원)': row.priceSource === 'ENDING_INVENTORY' ? Math.round(row.stockValue) : null,
        '단가구분': row.priceSource === 'ENDING_INVENTORY'
          ? (data?.priceAsOfLabel || '기말재고 단가')
          : row.priceSource === 'CURRENT_MONTH' ? '당월생산' : '단가없음',
      };

      // ✅ 물류 모드가 아닐 때만 엑셀에 위치정보 포함
      if (inventoryViewMode !== 'LOGISTICS') {
        rowData['위치정보'] = row.location === '-' ? '' : row.location;
      }

      rowData['소비기한'] = row.expirationDateStr;
      rowData['잔여일수'] = row.remainDaysNum !== '-' ? Number(row.remainDaysNum) : null;
      rowData['잔여율(%)'] = row.remainRateNum !== null ? Number(row.remainRateNum.toFixed(1)) : null;

      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "재고현황");
    
    XLSX.writeFile(workbook, `재고현황리포트_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <div className="p-10 text-center text-red-500">데이터를 불러오지 못했습니다.</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ValueKpiCard
          icon={Wallet}
          tone="emerald"
          label="재고금액 (현재 필터 기준)"
          value={formatWon(valueSummary.totalValue)}
          sub={`${data.priceAsOfLabel || '기말재고'} 단가 적용 · ${valueSummary.pricedItemCount.toLocaleString()}개 품목`}
        />
        <ValueKpiCard
          icon={Coins}
          tone="rose"
          label="폐기·임박 재고금액"
          value={formatWon(valueSummary.riskValue)}
          sub={
            valueSummary.totalValue > 0
              ? `전체 재고금액의 ${((valueSummary.riskValue / valueSummary.totalValue) * 100).toFixed(1)}%`
              : '해당 재고 없음'
          }
        />
        <ValueKpiCard
          icon={Factory}
          tone="amber"
          label="당월생산 (금액 미산정)"
          value={`${valueSummary.currentMonthItemCount.toLocaleString()}개 품목`}
          sub="직전 마감월에 없던 신규 생산분이라 단가가 아직 없습니다"
        />
        <ValueKpiCard
          icon={Layers}
          tone="blue"
          label="집계 대상"
          value={`${valueSummary.itemCount.toLocaleString()}개 품목`}
          sub={`${valueSummary.rowCount.toLocaleString()}개 배치 행`}
        />
      </div>

      <InventoryClassificationFilter
        stockType={stockType}
        productionLine={productionLine}
        onStockTypeChange={setStockType}
        onProductionLineChange={setProductionLine}
      />

      <div id="stock-table-top" className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto max-w-full">
          <TabButton label="전체" active={activeTab === 'all'} onClick={() => setActiveTab('all')} />
          <TabButton label="양호 (61일↑)" active={activeTab === 'healthy'} onClick={() => setActiveTab('healthy')} color="text-[#1565C0]" />
          <TabButton label="긴급 (31~60일)" active={activeTab === 'critical'} onClick={() => setActiveTab('critical')} color="text-[#F57F17]" />
          <TabButton label="임박 (1~30일)" active={activeTab === 'imminent'} onClick={() => setActiveTab('imminent')} color="text-[#E65100]" />
          <TabButton label="폐기" active={activeTab === 'disposed'} onClick={() => setActiveTab('disposed')} color="text-[#C62828]" />
          <TabButton label="기한없음" active={activeTab === 'no_expiry'} onClick={() => setActiveTab('no_expiry')} color="text-neutral-600" />
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={handleDownloadExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border bg-white text-green-700 border-green-200 hover:bg-green-50"
          >
            <Download size={14} />
            엑셀 다운로드
          </button>
          <button
            onClick={copyShareUrl}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            title="현재 필터 상태 URL 복사"
          >
            <Share2 size={14} />
            뷰 공유
          </button>
          <div className="relative w-full md:w-64">
            <input type="text" placeholder="제품명 또는 코드 검색..." {...searchInputProps} className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue bg-white" />
            <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse table-fixed min-w-[1280px]">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-2 py-3 border-b font-bold text-neutral-700 w-20 text-center">상태</th>
                
                {/* ✅ 제품명 영역의 과도한 너비 감소 (고정 비율 부여) */}
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-[28%]">제품명</th>
                <th className="px-3 py-3 border-b font-bold text-neutral-700 w-32">구분 / 라인</th>
                
                <th className="px-2 py-3 border-b font-bold text-neutral-700 text-center w-14">단위</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-800 text-right w-28 bg-blue-50/40">
                  {getStockColumnTitle()}
                </th>
                <th
                  className="px-4 py-3 border-b font-bold text-emerald-800 text-right w-32 bg-emerald-50/40"
                  title={`${data.priceAsOfLabel || '기말재고'} 단가 × 재고수량. 단가가 없는 자재는 당월 첫 생산분이라 금액을 산정하지 않습니다.`}
                >
                  재고금액
                </th>
                
                {/* ✅ 위치정보 영역을 대폭 확대 (22% 비율 확보) */}
                {inventoryViewMode !== 'LOGISTICS' && (
                  <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center w-[22%] border-l border-neutral-200 bg-neutral-50/50">
                    위치정보
                  </th>
                )}

                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center border-l border-neutral-200 w-28">소비기한</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right w-20">잔여일수</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right w-20">잔여율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedItems.map((row: BatchRow, idx: number) => {
                const displayStock = formatQty(row.batchQty, row.umrezBox, row.unit);

                return (
                  <tr key={`${row.code}-${row.expirationDateStr}-${idx}`} className="hover:bg-[#F9F9F9] transition-colors h-[52px]">
                    <td className="px-2 py-3 text-center text-neutral-400 text-xs">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    
                    <td className="px-2 py-3 text-center">
                        <StatusBadge status={row.status} />
                    </td>
                    
                    <td className="px-4 py-3">
                        <div className="flex items-start gap-1.5">
                          <button
                            onClick={() => toggleFavorite(row.code, row.name)}
                            className="mt-0.5 flex-shrink-0 text-neutral-300 hover:text-yellow-400 transition-colors"
                            title={isFavorite(row.code) ? '즐겨찾기 제거' : '즐겨찾기 추가'}
                          >
                            <Star size={13} fill={isFavorite(row.code) ? '#FBBF24' : 'none'} className={isFavorite(row.code) ? 'text-yellow-400' : ''} />
                          </button>
                          <div>
                            <Link href={`/product/${row.code}`} className="font-medium text-neutral-900 hover:text-[#1565C0] hover:underline line-clamp-2" title={row.name}>
                              {row.name}
                            </Link>
                            <div className="text-[11px] text-neutral-400 font-mono mt-0.5">{row.code}</div>
                          </div>
                        </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                          {INVENTORY_STOCK_TYPE_LABELS[row.stockType]}
                        </span>
                        {row.dispo && (
                          <span className="text-[10px] text-neutral-500">
                            {row.dispo}{row.productionLine ? ` · ${row.productionLine}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    
                    <td className="px-2 py-3 text-center text-neutral-500 text-xs">{row.unit}</td>
                    
                    <td className="px-4 py-3 text-right font-bold text-neutral-900 text-base bg-blue-50/20">
                      {displayStock.value} <span className="text-[10px] font-normal text-neutral-500 ml-1">{displayStock.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right bg-emerald-50/20 whitespace-nowrap">
                      <PriceCell priceSource={row.priceSource} stockValue={row.stockValue} />
                    </td>

                    {/* ✅ 위치정보 텍스트 생략 없이 여유롭게 렌더링 */}
                    {inventoryViewMode !== 'LOGISTICS' && (
                      <td className="px-4 py-3 text-center text-neutral-600 text-[13px] font-medium border-l border-neutral-200 bg-neutral-50/20 break-keep" title={row.location !== '-' ? row.location : ''}>
                        {row.location !== '-' ? row.location : ''}
                      </td>
                    )}
                    
                    <td className={`px-4 py-3 text-center text-neutral-600 font-mono text-sm ${inventoryViewMode === 'LOGISTICS' ? 'border-l border-neutral-200' : ''}`}>
                        {row.expirationDateStr}
                    </td>
                    
                    <td className={`px-4 py-3 text-right font-bold text-sm ${row.status === 'disposed' ? 'text-[#C62828]' : row.remainDaysNum === '-' ? 'text-neutral-400' : 'text-neutral-700'}`}>
                        {row.remainDaysNum === '-' ? '-' : `${row.remainDaysNum}일`}
                    </td>
                    
                    <td className="px-4 py-3 text-right">
                        {row.remainRateNum === null ? <span className="text-neutral-400">-</span> : (
                            <span className={`px-2 py-1 rounded text-[11px] font-bold ${row.remainRateNum < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>
                                {row.remainRateNum.toFixed(1)}%
                            </span>
                        )}
                    </td>
                  </tr>
                );
              })}
              {paginatedItems.length === 0 && (<tr><td colSpan={inventoryViewMode !== 'LOGISTICS' ? 11 : 10} className="p-10 text-center text-neutral-500 font-medium">선택한 재고 구분에 해당하는 데이터가 없습니다.</td></tr>)}
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

/** 억/만 단위로 접어서 보여준다. 재고금액은 자릿수가 커서 원 단위 그대로는 읽히지 않는다. */
function formatWon(value: number) {
  if (!value) return '0원';
  if (value >= 100000000) return `${(value / 100000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}억원`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString()}만원`;
  return `${Math.round(value).toLocaleString()}원`;
}

const KPI_TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
} as const;

function ValueKpiCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  tone: keyof typeof KPI_TONES;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-4 flex gap-3">
      <div className={`h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center ${KPI_TONES[tone]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-neutral-500">{label}</div>
        <div className="text-[19px] font-bold text-neutral-900 leading-tight mt-0.5">{value}</div>
        <div className="text-[11px] text-neutral-400 mt-1 break-keep">{sub}</div>
      </div>
    </div>
  );
}

/** 단가가 없는 자재는 0원으로 뭉개지 않고 "당월생산"으로 구분해 보여준다. */
function PriceCell({ priceSource, stockValue }: { priceSource: PriceSource; stockValue: number }) {
  if (priceSource === 'ENDING_INVENTORY') {
    return (
      <span className="font-bold text-emerald-800">
        {Math.round(stockValue).toLocaleString()}원
      </span>
    );
  }

  if (priceSource === 'CURRENT_MONTH') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200"
        title="직전 마감월 기말재고에 없던 자재입니다. 당월 첫 생산분이라 확정 단가가 아직 없습니다."
      >
        <Factory size={10} />
        당월생산
      </span>
    );
  }

  return <span className="text-neutral-300">-</span>;
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
      no_expiry: { bg: '#F5F5F5', text: '#757575', label: '기한없음' },
      quality_hold: { bg: '#F3E5F5', text: '#7B1FA2', label: '품질대기' }
  };
  const c = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (<span className="px-2.5 py-1 rounded text-xs font-bold border border-transparent" style={{ backgroundColor: c.bg, color: c.text }}>{c.label}</span>);
}

export default function StockStatusPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>}>
      <StockStatusPageInner />
    </Suspense>
  );
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
