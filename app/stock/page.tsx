// app/stock/page.tsx
// 재고 통합 장표 — 예전 '재고 현황'(배치·유통기한)과 '재고 분석'(ADS·회전일)을 한 화면에 합친 페이지다.
// 계산은 lib/inventory-board.ts 한 곳에서만 하고 여기서는 표시·필터·정렬만 한다.
'use client'

import { useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useKoreanInput } from '@/hooks/use-korean-input';
import { useFavorites } from '@/hooks/use-favorites';
import { useUiStore } from '@/store/ui-store';
import { useDateStore } from '@/store/date-store';
import { format, subDays } from 'date-fns';
import * as XLSX from 'xlsx';
import {
  ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Boxes, CheckSquare, ChevronDown, ChevronLeft,
  ChevronRight, Coins, Download, Eye, EyeOff, Factory, Layers, Maximize2, Minimize2, Rows3,
  Search, Share2, Square, Star, TableProperties, Wallet,
} from 'lucide-react';
import InfoTooltip from '@/components/info-tooltip';
import InventoryClassificationFilter from '@/components/inventory-classification-filter';
import { DashboardAnalysis } from '@/types/analysis';
import {
  INVENTORY_STOCK_TYPE_LABELS,
  InventoryStockTypeFilter,
  getProductionLine,
} from '@/lib/inventory-classification';
import { INVENTORY_STATUS_RULE_TEXT, type InventoryRiskStatus } from '@/lib/inventory-status';
import {
  buildInventoryBoard,
  INVENTORY_BOARD_STATUS_LABELS,
  INVENTORY_STATUS_ORDER,
  type InventoryBoardBatchRow,
  type InventoryBoardBuckets,
  type InventoryBoardItemRow,
  type InventoryBoardStatus,
  type InventoryStatusFilter,
} from '@/lib/inventory-board';
import type { PriceSource } from '@/lib/ending-inventory-price';

type SortKey =
  | 'name' | 'ads30' | 'ads60' | 'ads90' | 'future' | 'qualityStock'
  | 'usableStock' | 'wasteStock' | 'stockValue' | 'turnoverDays' | 'minRemain'
  | 'bucket_under50' | 'bucket_50_70' | 'bucket_70_75' | 'bucket_75_85' | 'bucket_over85' | 'bucket_noExpiry';
type SortDirection = 'asc' | 'desc';
type ViewLayout = 'item' | 'batch';
/** 품목 뷰 열 밀도 — compact: 핵심 7열, full: 예전 분석표 전 컬럼 */
type ColumnDensity = 'compact' | 'full';

/** 엑셀 시트 한 줄. 컬럼이 필터에 따라 늘었다 줄었다 해서 키를 고정하지 않는다. */
type ExcelRow = Record<string, string | number | null>;

const ITEMS_PER_PAGE = 15;
const BATCHES_PER_PAGE = 30;

/**
 * ADS 판정 기준은 화면에 그대로 노출한다 — 왜 이 숫자가 나왔는지 사용자가 근거까지 보고 판단하는 구조다.
 * 판매출고만 세면 스프·양념장처럼 전량 재투입되는 제품이 '소진 0' 으로 잡혀 회전일이 비었다.
 */
const ADS_BASIS_TEXT = 'ADS = 납품출고 + 생산투입 순소요(MB51 261-262) 일평균';

function InventoryBoardPageInner() {
  const { unitMode, inventoryViewMode, favoritesOnly } = useUiStore();
  const { endDate: storeEndDate } = useDateStore();
  const { getParam, getIntParam, setParams, copyShareUrl } = useUrlFilters();
  const { isFavorite, toggle: toggleFavorite } = useFavorites();

  // ADS(30/60/90)는 항상 '오늘 기준 최근 90일'이라 헤더의 조회기간과 무관하게 고정 구간으로 읽는다.
  // (헤더 날짜를 과거로 당기면 ADS 가 과소 집계되던 문제 때문에 재고 분석 화면이 쓰던 방식을 유지한다)
  // ADS 는 납품출고 + 생산투입 순소요(MB51 261-262)의 일평균이다 — lib/analysis.ts 참고.
  const today = new Date();
  const queryEndDate = format(subDays(today, 1), 'yyyy-MM-dd');
  const queryStartDate = format(subDays(today, 90), 'yyyy-MM-dd');

  const { data, isLoading } = useQuery<DashboardAnalysis>({
    queryKey: ['inventory-analysis', queryStartDate, queryEndDate],
    queryFn: async () => {
      const res = await getDashboardData(queryStartDate, queryEndDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const layout = (getParam('view', 'item') || 'item') as ViewLayout;
  const activeTab = (getParam('tab', 'all') || 'all') as InventoryStatusFilter;
  const searchTerm = getParam('search', '');
  const currentPage = getIntParam('page', 1);
  const stockType = (getParam('stockType', 'ALL') || 'ALL') as InventoryStockTypeFilter;
  const productionLine = getParam('line', 'ALL') || 'ALL';
  const sortKey = (getParam('sort', 'usableStock') || 'usableStock') as SortKey;
  const sortDir = (getParam('dir', 'desc') || 'desc') as SortDirection;
  const showQuality = getParam('quality', '') === '1';
  const includeQualityInUsable = getParam('qsum', '') === '1';
  // 품목 뷰 열 밀도. 기본은 요약(7열) — 17열을 한꺼번에 펴두면 읽히지 않는다.
  const density = (getParam('density', 'compact') || 'compact') as ColumnDensity;
  const sortConfig = { key: sortKey, direction: sortDir };

  const setLayout = (value: ViewLayout) => setParams({ view: value === 'item' ? null : value, page: null });
  const setDensity = (value: ColumnDensity) => setParams({ density: value === 'compact' ? null : value });
  const setActiveTab = (value: InventoryStatusFilter) => setParams({ tab: value === 'all' ? null : value, page: null });
  const setSearchTerm = (value: string) => setParams({ search: value || null, page: null });
  const setCurrentPage = (page: number) => setParams({ page: page > 1 ? String(page) : null });
  const setStockType = (value: InventoryStockTypeFilter) => setParams({ stockType: value === 'ALL' ? null : value, page: null });
  const setProductionLine = (value: string) => setParams({ line: value === 'ALL' ? null : value, page: null });
  // 품질재고를 숨기면 '가용재고 합산'도 같이 꺼야 집계와 화면이 어긋나지 않는다
  const toggleShowQuality = () => setParams(showQuality ? { quality: null, qsum: null } : { quality: '1' });
  const toggleIncludeQuality = () => setParams({ qsum: includeQualityInUsable ? null : '1' });
  const searchInputProps = useKoreanInput(searchTerm, setSearchTerm);

  const handleSort = (key: SortKey) => {
    const newDir: SortDirection = sortConfig.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc';
    setParams({ sort: key, dir: newDir, page: null });
  };

  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const toggleExpanded = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const quantityMode = inventoryViewMode !== 'LOGISTICS';
  const showQualityColumn = showQuality && quantityMode;

  const board = useMemo(() => {
    if (!data) return null;
    return buildInventoryBoard(data, {
      viewMode: inventoryViewMode,
      stockType,
      productionLine,
      statusFilter: activeTab,
      searchTerm,
      favoritesOnly,
      isFavorite,
      showQuality,
      includeQualityInUsable,
      targetDate: storeEndDate,
    });
  }, [
    data, inventoryViewMode, stockType, productionLine, activeTab, searchTerm,
    favoritesOnly, isFavorite, showQuality, includeQualityInUsable, storeEndDate,
  ]);

  const sortedItems = useMemo(() => {
    if (!board) return [];
    const list = [...board.items];

    list.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      switch (sortConfig.key) {
        case 'name': valA = a.name; valB = b.name; break;
        case 'ads30': valA = a.ads30; valB = b.ads30; break;
        case 'ads60': valA = a.ads60; valB = b.ads60; break;
        case 'ads90': valA = a.ads90; valB = b.ads90; break;
        case 'future': valA = a.targetDatePlan; valB = b.targetDatePlan; break;
        case 'qualityStock': valA = a.qualityStock; valB = b.qualityStock; break;
        case 'usableStock': valA = a.usableStock; valB = b.usableStock; break;
        case 'wasteStock': valA = a.wasteStock; valB = b.wasteStock; break;
        case 'stockValue': valA = a.stockValue; valB = b.stockValue; break;
        case 'turnoverDays': valA = a.turnoverDays; valB = b.turnoverDays; break;
        // 기한없음 품목은 '잔여일 무한대'로 두어 정렬 시 항상 뒤로 보낸다
        case 'minRemain':
          valA = a.minRemainDays ?? Number.POSITIVE_INFINITY;
          valB = b.minRemainDays ?? Number.POSITIVE_INFINITY;
          break;
        case 'bucket_under50': valA = a.buckets.under50; valB = b.buckets.under50; break;
        case 'bucket_50_70': valA = a.buckets.r50_70; valB = b.buckets.r50_70; break;
        case 'bucket_70_75': valA = a.buckets.r70_75; valB = b.buckets.r70_75; break;
        case 'bucket_75_85': valA = a.buckets.r75_85; valB = b.buckets.r75_85; break;
        case 'bucket_over85': valA = a.buckets.over85; valB = b.buckets.over85; break;
        case 'bucket_noExpiry': valA = a.buckets.noExpiry; valB = b.buckets.noExpiry; break;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return a.code.localeCompare(b.code);
    });

    return list;
  }, [board, sortConfig.key, sortConfig.direction]);

  const perPage = layout === 'item' ? ITEMS_PER_PAGE : BATCHES_PER_PAGE;
  const totalRows = layout === 'item' ? sortedItems.length : board?.batches.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / perPage));
  const safePage = Math.min(currentPage, totalPages);

  const pagedItems = useMemo(
    () => sortedItems.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE),
    [sortedItems, safePage]
  );
  const pagedBatches = useMemo(
    () => (board?.batches || []).slice((safePage - 1) * BATCHES_PER_PAGE, safePage * BATCHES_PER_PAGE),
    [board, safePage]
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    document.getElementById('inventory-board-table')?.scrollIntoView({ behavior: 'smooth' });
  };

  const formatQty = (val: number | undefined | null, conversion: number, baseUnit: string, fixed?: number) => {
    const safeVal = val ?? 0;
    const maxDecimals = fixed !== undefined ? fixed : unitMode === 'BOX' ? 1 : undefined;

    if (unitMode === 'BOX') {
      const boxes = safeVal / (conversion > 0 ? conversion : 1);
      return {
        value: boxes.toLocaleString(undefined, { maximumFractionDigits: maxDecimals }),
        unit: 'BOX',
        rawValue: Number(boxes.toFixed(maxDecimals ?? 1)),
      };
    }
    return {
      value: safeVal.toLocaleString(undefined, { maximumFractionDigits: maxDecimals }),
      unit: baseUnit,
      rawValue: safeVal,
    };
  };

  /** 품목요약 + 배치상세 두 시트를 한 파일에 담는다. 화면이 하나가 됐으니 파일도 하나여야 한다. */
  const handleDownloadExcel = () => {
    if (!board) return;
    const priceLabel = data?.priceAsOfLabel || '기말재고 단가';

    const itemSheet = sortedItems.map((item) => {
      const row: ExcelRow = {
        '제품명': item.name,
        '코드': item.code,
        '재고구분': item.stockTypes.map((type) => INVENTORY_STOCK_TYPE_LABELS[type]).join(', '),
        'DISPO': item.dispoCodes.join(', '),
        '생산라인': item.productionLines.join(', '),
        'ADS(30)': formatQty(item.ads30, item.umrezBox, item.unit, 0).rawValue,
        'ADS(60)': formatQty(item.ads60, item.umrezBox, item.unit, 0).rawValue,
        'ADS(90)': formatQty(item.ads90, item.umrezBox, item.unit, 0).rawValue,
        // ADS 는 합계값이라 근거를 함께 내린다. 판매분은 ADS - 생산투입분이다.
        'ADS(60) 판매출고분': formatQty(item.ads60 - item.usageAds60, item.umrezBox, item.unit, 0).rawValue,
        'ADS(60) 생산투입분': formatQty(item.usageAds60, item.umrezBox, item.unit, 0).rawValue,
        '생산계획(기준일)': formatQty(item.targetDatePlan, item.umrezBox, item.unit).rawValue,
      };

      if (showQualityColumn) {
        row['품질재고'] = formatQty(item.qualityStock, item.umrezBox, item.unit).rawValue;
      }

      row['가용재고'] = formatQty(item.usableStock, item.umrezBox, item.unit).rawValue;
      row['폐기재고'] = formatQty(item.wasteStock, item.umrezBox, item.unit).rawValue;
      row['재고금액(원)'] = item.priceSource === 'ENDING_INVENTORY' ? Math.round(item.stockValue) : null;
      row['단가구분'] = describePriceSource(item.priceSource, priceLabel);
      row['회전일(90)'] = item.ads90 > 0 && item.turnoverDays < 90000 ? Math.round(item.turnoverDays) : null;
      row['최단잔여일'] = item.minRemainDays;

      INVENTORY_STATUS_ORDER.forEach((status) => {
        row[`${INVENTORY_BOARD_STATUS_LABELS[status]}재고`] =
          formatQty(item.statusQty[status], item.umrezBox, item.unit).rawValue;
      });

      BUCKET_COLUMNS.forEach(({ key, label }) => {
        row[label] = formatQty(item.buckets[key], item.umrezBox, item.unit).rawValue;
        row[`${label} 금액(원)`] =
          item.priceSource === 'ENDING_INVENTORY' ? Math.round(item.bucketValues[key]) : null;
      });

      return row;
    });

    const batchSheet = board.batches.map((row, idx) => {
      const qty = formatQty(row.quantity, row.umrezBox, row.unit);
      const record: ExcelRow = {
        'No': idx + 1,
        '상태': INVENTORY_BOARD_STATUS_LABELS[row.status],
        '제품명': row.name,
        '코드': row.code,
        '재고구분': INVENTORY_STOCK_TYPE_LABELS[row.stockType],
        'DISPO': row.dispo || '',
        '생산라인': row.productionLine || '',
        '단위': unitMode === 'BOX' ? 'BOX' : row.unit,
        '재고수량': qty.rawValue,
        '재고금액(원)': row.priceSource === 'ENDING_INVENTORY' ? Math.round(row.stockValue) : null,
        '단가구분': describePriceSource(row.priceSource, priceLabel),
        '보관처': row.source === 'FBH' ? '물류센터(FBH)' : '플랜트',
      };
      if (quantityMode) record['위치정보'] = row.location === '-' ? '' : row.location;
      record['소비기한'] = row.expirationDateStr;
      record['잔여일수'] = row.remainDays;
      record['잔여율(%)'] = row.remainRate !== null ? Number(row.remainRate.toFixed(1)) : null;
      return record;
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemSheet), '품목요약');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(batchSheet), '배치상세');
    XLSX.writeFile(workbook, `재고통합장표_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data || !board) return <div className="p-10 text-center text-[#E53935]">데이터를 불러오지 못했습니다.</div>;

  const priceLabel = data.priceAsOfLabel || '기말재고';
  const isCompact = density === 'compact';
  const itemColCount = isCompact ? 7 : showQualityColumn ? 17 : 16;
  const batchColCount = quantityMode ? 11 : 10;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
      {/* 헤더 */}
      <div className="pb-4 border-b border-neutral-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            <Boxes size={21} className="text-blue-600" />
            재고 통합 장표
          </h1>
          <p className="text-[12px] text-neutral-700 mt-1 flex flex-wrap items-center gap-2">
            <span>유통기한(배치) · 재고금액 · 소진속도(ADS) · 회전일을 한 화면에서 봅니다</span>
            <span className={`text-[10px] px-2 py-0.5 rounded text-white font-bold ${
              inventoryViewMode === 'ALL' ? 'bg-green-600' : inventoryViewMode === 'LOGISTICS' ? 'bg-purple-600' : 'bg-blue-600'
            }`}>
              현재 모드: {inventoryViewMode === 'ALL' ? '통합' : inventoryViewMode === 'LOGISTICS' ? '물류센터' : '플랜트'}
            </span>
            <span className="text-[10px] text-neutral-400">{INVENTORY_STATUS_RULE_TEXT}</span>
            <span className="text-[10px] text-neutral-400">{ADS_BASIS_TEXT}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownloadExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border bg-white text-green-700 border-green-200 hover:bg-green-50"
            title="품목요약 · 배치상세 두 시트로 내려받습니다"
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
          {quantityMode && (
            <button
              onClick={toggleShowQuality}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                showQuality ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {showQuality ? <Eye size={14} /> : <EyeOff size={14} />}
              {showQuality ? '품질재고 숨기기' : '숨은 재고(품질) 보기'}
            </button>
          )}
          {showQualityColumn && (
            <button
              onClick={toggleIncludeQuality}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                includeQualityInUsable ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
              }`}
              title="품질 대기 재고를 가용 재고에 포함하여 분석합니다."
            >
              {includeQualityInUsable ? <CheckSquare size={14} /> : <Square size={14} />}
              가용재고 합산
            </button>
          )}
        </div>
      </div>

      {/* KPI — 금액 4장 + 판매속도 1장. ADS 를 카드 3장으로 펴면 헤더만 두 줄이 된다 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <ValueKpiCard
          icon={Wallet}
          tone="emerald"
          label="재고금액 (현재 필터 기준)"
          value={formatWon(board.summary.totalValue)}
          sub={`${priceLabel} 단가 적용 · ${board.summary.pricedItemCount.toLocaleString()}개 품목`}
        />
        <ValueKpiCard
          icon={Coins}
          tone="rose"
          label="폐기·임박 재고금액"
          value={formatWon(board.summary.riskValue)}
          sub={
            board.summary.totalValue > 0
              ? `전체 재고금액의 ${((board.summary.riskValue / board.summary.totalValue) * 100).toFixed(1)}%`
              : '해당 재고 없음'
          }
        />
        <ValueKpiCard
          icon={Factory}
          tone="amber"
          label="당월생산 (금액 미산정)"
          value={`${board.summary.currentMonthItemCount.toLocaleString()}개 품목`}
          sub="직전 마감월에 없던 신규 생산분이라 단가가 아직 없습니다"
        />
        <ValueKpiCard
          icon={Layers}
          tone="blue"
          label="집계 대상"
          value={`${board.summary.itemCount.toLocaleString()}개 품목`}
          sub={`${board.summary.batchRowCount.toLocaleString()}개 배치 행`}
        />
        <AdsSummaryCard
          ads30={board.summary.totalAds30}
          ads60={board.summary.totalAds60}
          ads90={board.summary.totalAds90}
          usageAds30={board.summary.totalUsageAds30}
          usageAds60={board.summary.totalUsageAds60}
          usageAds90={board.summary.totalUsageAds90}
          unitMode={unitMode}
        />
      </div>

      <InventoryClassificationFilter
        stockType={stockType}
        productionLine={productionLine}
        onStockTypeChange={setStockType}
        onProductionLineChange={setProductionLine}
      />

      {/* 상태 탭 · 보기 전환 · 검색 */}
      <div id="inventory-board-table" className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-3">
        <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto max-w-full">
          <TabButton label="전체" active={activeTab === 'all'} onClick={() => setActiveTab('all')} />
          <TabButton label="양호 (61일↑)" active={activeTab === 'healthy'} onClick={() => setActiveTab('healthy')} color="text-[#1565C0]" />
          <TabButton label="긴급 (31~60일)" active={activeTab === 'critical'} onClick={() => setActiveTab('critical')} color="text-[#F57F17]" />
          <TabButton label="임박 (1~30일)" active={activeTab === 'imminent'} onClick={() => setActiveTab('imminent')} color="text-[#E65100]" />
          <TabButton label="폐기" active={activeTab === 'disposed'} onClick={() => setActiveTab('disposed')} color="text-[#C62828]" />
          <TabButton label="기한없음" active={activeTab === 'no_expiry'} onClick={() => setActiveTab('no_expiry')} color="text-neutral-600" />
        </div>

        <div className="flex items-center gap-2 justify-between xl:justify-end">
          <div className="flex bg-neutral-100 p-1 rounded-lg">
            <button
              onClick={() => setLayout('item')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                layout === 'item' ? 'bg-white shadow-sm text-neutral-900 border border-neutral-200/50' : 'text-neutral-500 hover:text-neutral-700'
              }`}
              title="품목 한 줄 + 클릭 시 배치 상세 펼침"
            >
              <TableProperties size={14} /> 품목 단위
            </button>
            <button
              onClick={() => setLayout('batch')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
                layout === 'batch' ? 'bg-white shadow-sm text-neutral-900 border border-neutral-200/50' : 'text-neutral-500 hover:text-neutral-700'
              }`}
              title="모든 배치를 잔여일 짧은 순으로 나열"
            >
              <Rows3 size={14} /> 배치 단위
            </button>
          </div>

          <div className="relative w-full md:w-64">
            <input
              type="text"
              placeholder="제품명 또는 코드 검색..."
              {...searchInputProps}
              className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue bg-white"
            />
            <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-3 bg-[#FAFAFA] border-b border-neutral-200 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-2 font-bold text-neutral-700 text-sm">
            {layout === 'item' ? <TableProperties size={16} className="text-blue-600" /> : <Rows3 size={16} className="text-blue-600" />}
            <span>{layout === 'item' ? '품목별 재고 · ADS · 유통기한 요약' : '배치(소비기한)별 재고 상세'}</span>
            {activeTab !== 'all' && (
              <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {INVENTORY_BOARD_STATUS_LABELS[activeTab as InventoryRiskStatus]} 배치만 집계 중
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-normal text-neutral-500">
              {layout === 'item' ? '행을 클릭하면 상세가 펼쳐집니다 · ' : ''}
              단위: {unitMode === 'BOX' ? 'BOX (환산)' : '기준 (EA/KG)'}
            </span>
            {layout === 'item' && (
              <div className="flex bg-neutral-100 p-0.5 rounded-md">
                <button
                  onClick={() => setDensity('compact')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-all ${
                    density === 'compact' ? 'bg-white shadow-sm text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                  title="핵심 7열만 봅니다. 세부 수치는 행을 펼치면 전부 나옵니다"
                >
                  <Minimize2 size={12} /> 요약
                </button>
                <button
                  onClick={() => setDensity('full')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-all ${
                    density === 'full' ? 'bg-white shadow-sm text-neutral-800' : 'text-neutral-500 hover:text-neutral-700'
                  }`}
                  title="ADS 3구간 · 잔여율 6구간을 모두 펼친 표"
                >
                  <Maximize2 size={12} /> 상세
                </button>
              </div>
            )}
          </div>
          {layout === 'item' && isCompact && <BarLegend />}
        </div>

        <div className="overflow-x-auto min-h-[420px]">
          {layout === 'item' ? (
            <table className={`w-full text-sm text-left border-collapse ${isCompact ? 'min-w-[1040px]' : 'min-w-[1720px]'}`}>
              <thead className="bg-[#FAFAFA]">
                {isCompact ? (
                  <tr>
                    <SortableHeader
                      label="제품명" sortKey="name" currentSort={sortConfig} onSort={handleSort}
                      className="sticky left-0 z-20 bg-[#FAFAFA] border-r border-neutral-200" width="300px"
                    />
                    <SortableHeader
                      label="재고" sortKey="usableStock" currentSort={sortConfig} onSort={handleSort} align="right" width="150px"
                      tooltip="가용재고입니다. 폐기·품질대기 수량은 아래에 작게 붙습니다."
                    />
                    <SortableHeader
                      label="재고금액" sortKey="stockValue" currentSort={sortConfig} onSort={handleSort} align="right" width="130px"
                      tooltip={`${priceLabel} 단가 × 현재 재고수량. 단가가 없는 자재는 당월 첫 생산분이라 금액을 산정하지 않습니다.`}
                    />
                    <SortableHeader
                      label="회전일(90)" sortKey="turnoverDays" currentSort={sortConfig} onSort={handleSort} align="right" width="130px"
                      tooltip={`가용재고 ÷ ADS(90). 아래 작은 값은 ADS(60)입니다. ${ADS_BASIS_TEXT}`}
                    />
                    <SortableHeader
                      label="유통기한" sortKey="minRemain" currentSort={sortConfig} onSort={handleSort} align="left" width="200px"
                      className="border-l border-neutral-200"
                      tooltip={`가장 짧은 잔여일과 상태별 재고 비중입니다. ${INVENTORY_STATUS_RULE_TEXT}`}
                    />
                    <SortableHeader
                      label="잔여율 분포" sortKey="bucket_under50" currentSort={sortConfig} onSort={handleSort} align="left" width="180px"
                      tooltip="잔여율 구간별 재고 비중입니다. 정렬은 위험구간(~50%) 수량 기준이며, 구간별 수량·금액은 행을 펼치면 나옵니다."
                    />
                    <SortableHeader
                      label="생산계획" sortKey="future" currentSort={sortConfig} onSort={handleSort} align="center" width="110px"
                      tooltip="헤더에서 고른 조회 종료일의 생산계획 수량입니다."
                    />
                  </tr>
                ) : (
                <tr>
                  <SortableHeader
                    label="제품명" sortKey="name" currentSort={sortConfig} onSort={handleSort}
                    className="sticky left-0 z-20 bg-[#FAFAFA] border-r border-neutral-200" width="280px"
                  />
                  <SortableHeader label="ADS(30)" sortKey="ads30" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-blue-50/20" tooltip={`최근 30일 평균 일소진량. ${ADS_BASIS_TEXT}. 아래 작은 값은 그중 생산투입분입니다.`} />
                  <SortableHeader label="ADS(60)" sortKey="ads60" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-blue-50/40" tooltip={`최근 60일 평균 일소진량. 기본 재고회전 기준값. ${ADS_BASIS_TEXT}`} />
                  <SortableHeader label="ADS(90)" sortKey="ads90" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-blue-50/60" tooltip={`최근 90일 평균 일소진량. 회전일수 계산 기준. ${ADS_BASIS_TEXT}`} />
                  <SortableHeader label="생산계획(기준일)" sortKey="future" currentSort={sortConfig} onSort={handleSort} align="center" tooltip="헤더에서 고른 조회 종료일의 생산계획 수량입니다." />
                  {showQualityColumn && (
                    <SortableHeader label="품질재고" sortKey="qualityStock" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-purple-50 text-purple-700" />
                  )}
                  <SortableHeader label="가용재고" sortKey="usableStock" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-green-50/30 text-green-800" />
                  <SortableHeader label="폐기재고" sortKey="wasteStock" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-red-50/50 text-[#C62828]" />
                  <SortableHeader label="재고금액" sortKey="stockValue" currentSort={sortConfig} onSort={handleSort} align="right" className="bg-emerald-50/40 text-emerald-800" tooltip={`${priceLabel} 단가 × 현재 재고수량. 단가가 없는 자재는 당월 첫 생산분이라 금액을 산정하지 않습니다.`} />
                  <SortableHeader label="회전일(90)" sortKey="turnoverDays" currentSort={sortConfig} onSort={handleSort} align="right" className="text-red-700 bg-red-50/10" tooltip={`가용재고 ÷ ADS(90). ${ADS_BASIS_TEXT}`} />
                  <SortableHeader label="유통기한" sortKey="minRemain" currentSort={sortConfig} onSort={handleSort} align="left" className="bg-neutral-50/60 border-l border-neutral-200" width="190px" tooltip={`상단은 가장 짧은 잔여일, 하단은 상태별 재고수량입니다. ${INVENTORY_STATUS_RULE_TEXT}`} />
                  <SortableHeader label="~50% (유효)" sortKey="bucket_under50" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#C62828] bg-red-50/30 border-l border-neutral-200" tooltip="상단은 구간별 수량, 하단은 기말재고 단가를 적용한 구간별 재고금액입니다." />
                  <SortableHeader label="50~70%" sortKey="bucket_50_70" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#E65100] bg-orange-50/30" tooltip="상단은 구간별 수량, 하단은 기말재고 단가를 적용한 구간별 재고금액입니다." />
                  <SortableHeader label="70~75%" sortKey="bucket_70_75" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#F57F17] bg-yellow-50/50" tooltip="상단은 구간별 수량, 하단은 기말재고 단가를 적용한 구간별 재고금액입니다." />
                  <SortableHeader label="75~85%" sortKey="bucket_75_85" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#1565C0] bg-blue-50/30" tooltip="상단은 구간별 수량, 하단은 기말재고 단가를 적용한 구간별 재고금액입니다." />
                  <SortableHeader label="85%~" sortKey="bucket_over85" currentSort={sortConfig} onSort={handleSort} align="right" className="text-[#2E7D32] bg-green-50/30" tooltip="상단은 구간별 수량, 하단은 기말재고 단가를 적용한 구간별 재고금액입니다." />
                  <SortableHeader label="기한없음" sortKey="bucket_noExpiry" currentSort={sortConfig} onSort={handleSort} align="right" className="text-neutral-600 bg-neutral-50/60" tooltip="유통기한이 없는 재고입니다. 잔여율 구간에 섞이면 '~50%'로 오해되므로 따로 셉니다." />
                </tr>
                )}
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {pagedItems.map((item) => {
                  const expanded = expandedCodes.has(item.code);
                  return (
                    <ItemRows
                      key={item.code}
                      item={item}
                      expanded={expanded}
                      onToggle={() => toggleExpanded(item.code)}
                      colCount={itemColCount}
                      compact={isCompact}
                      showQualityColumn={showQualityColumn}
                      quantityMode={quantityMode}
                      formatQty={formatQty}
                      priceLabel={priceLabel}
                      isFavorite={isFavorite(item.code)}
                      onToggleFavorite={() => toggleFavorite(item.code, item.name)}
                    />
                  );
                })}
                {pagedItems.length === 0 && (
                  <tr>
                    <td colSpan={itemColCount} className="p-10 text-center text-neutral-500 font-medium">
                      선택한 조건에 해당하는 재고가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm text-left border-collapse table-fixed min-w-[1280px]">
              <thead className="bg-[#FAFAFA]">
                <tr>
                  <th className="px-2 py-3 border-b font-bold text-neutral-700 w-12 text-center">No</th>
                  <th className="px-2 py-3 border-b font-bold text-neutral-700 w-20 text-center">상태</th>
                  <th className="px-4 py-3 border-b font-bold text-neutral-700 w-[26%]">제품명</th>
                  <th className="px-3 py-3 border-b font-bold text-neutral-700 w-32">구분 / 라인</th>
                  <th className="px-2 py-3 border-b font-bold text-neutral-700 text-center w-14">단위</th>
                  <th className="px-4 py-3 border-b font-bold text-neutral-800 text-right w-28 bg-blue-50/40">재고수량</th>
                  <th
                    className="px-4 py-3 border-b font-bold text-emerald-800 text-right w-32 bg-emerald-50/40"
                    title={`${priceLabel} 단가 × 재고수량. 단가가 없는 자재는 당월 첫 생산분이라 금액을 산정하지 않습니다.`}
                  >
                    재고금액
                  </th>
                  {quantityMode && (
                    <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center w-[20%] border-l border-neutral-200 bg-neutral-50/50">
                      위치정보
                    </th>
                  )}
                  <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center border-l border-neutral-200 w-28">소비기한</th>
                  <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right w-20">잔여일수</th>
                  <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right w-20">잔여율</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {pagedBatches.map((row, idx) => {
                  const qty = formatQty(row.quantity, row.umrezBox, row.unit);
                  return (
                    <tr key={`${row.code}-${row.expirationDateStr}-${row.location}-${idx}`} className="hover:bg-[#F9F9F9] transition-colors h-[52px]">
                      <td className="px-2 py-3 text-center text-neutral-400 text-xs">{(safePage - 1) * BATCHES_PER_PAGE + idx + 1}</td>
                      <td className="px-2 py-3 text-center"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-1.5">
                          <button
                            onClick={() => toggleFavorite(row.code, row.name)}
                            className="mt-0.5 flex-shrink-0 text-neutral-300 hover:text-yellow-400 transition-colors"
                            title={isFavorite(row.code) ? '즐겨찾기 제거' : '즐겨찾기 추가'}
                          >
                            <Star size={13} fill={isFavorite(row.code) ? '#FBBF24' : 'none'} className={isFavorite(row.code) ? 'text-yellow-400' : ''} />
                          </button>
                          <div className="min-w-0">
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
                      <td className="px-2 py-3 text-center text-neutral-500 text-xs">{qty.unit}</td>
                      <td className="px-4 py-3 text-right font-bold text-neutral-900 text-base bg-blue-50/20">{qty.value}</td>
                      <td className="px-4 py-3 text-right bg-emerald-50/20 whitespace-nowrap">
                        <PriceCell priceSource={row.priceSource} stockValue={row.stockValue} />
                      </td>
                      {quantityMode && (
                        <td className="px-4 py-3 text-center text-neutral-600 text-[13px] font-medium border-l border-neutral-200 bg-neutral-50/20 break-keep" title={row.location !== '-' ? row.location : ''}>
                          {row.location !== '-' ? row.location : ''}
                        </td>
                      )}
                      <td className={`px-4 py-3 text-center text-neutral-600 font-mono text-sm ${!quantityMode ? 'border-l border-neutral-200' : ''}`}>
                        {row.expirationDateStr}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold text-sm ${row.status === 'disposed' ? 'text-[#C62828]' : row.remainDays === null ? 'text-neutral-400' : 'text-neutral-700'}`}>
                        {row.remainDays === null ? '-' : `${row.remainDays}일`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.remainRate === null ? <span className="text-neutral-400">-</span> : (
                          <span className={`px-2 py-1 rounded text-[11px] font-bold ${row.remainRate < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>
                            {row.remainRate.toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {pagedBatches.length === 0 && (
                  <tr>
                    <td colSpan={batchColCount} className="p-10 text-center text-neutral-500 font-medium">
                      선택한 조건에 해당하는 재고가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => handlePageChange(Math.max(1, safePage - 1))} disabled={safePage === 1} className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft size={20} />
            </button>
            <span className="text-sm font-bold text-neutral-600">
              {safePage} / {totalPages}
              <span className="ml-2 font-normal text-neutral-400">
                ({totalRows.toLocaleString()}{layout === 'item' ? '개 품목' : '개 배치'})
              </span>
            </span>
            <button onClick={() => handlePageChange(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const BUCKET_COLUMNS: Array<{ key: keyof InventoryBoardBuckets; label: string; className: string }> = [
  { key: 'under50', label: '~50% (유효)', className: 'text-[#C62828] bg-red-50/30 border-l border-neutral-200' },
  { key: 'r50_70', label: '50~70%', className: 'text-[#E65100] bg-orange-50/30' },
  { key: 'r70_75', label: '70~75%', className: 'text-[#F57F17] bg-yellow-50/50' },
  { key: 'r75_85', label: '75~85%', className: 'text-[#1565C0] bg-blue-50/30' },
  { key: 'over85', label: '85%~', className: 'text-[#2E7D32] bg-green-50/30' },
  { key: 'noExpiry', label: '기한없음', className: 'text-neutral-600 bg-neutral-50/60' },
];

type FormatQty = (val: number | undefined | null, conversion: number, baseUnit: string, fixed?: number) =>
  { value: string; unit: string; rawValue: number };

/** 품목 요약 행 + (펼쳤을 때) 분석 수치 + 배치 상세 행 */
function ItemRows({
  item, expanded, onToggle, colCount, compact, showQualityColumn, quantityMode, formatQty, priceLabel, isFavorite, onToggleFavorite,
}: {
  item: InventoryBoardItemRow;
  expanded: boolean;
  onToggle: () => void;
  colCount: number;
  compact: boolean;
  showQualityColumn: boolean;
  quantityMode: boolean;
  formatQty: FormatQty;
  priceLabel: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const dUsable = formatQty(item.usableStock, item.umrezBox, item.unit);
  const dWaste = formatQty(item.wasteStock, item.umrezBox, item.unit);
  const dQuality = formatQty(item.qualityStock, item.umrezBox, item.unit);
  const dPlan = formatQty(item.targetDatePlan, item.umrezBox, item.unit);
  const dAds30 = formatQty(item.ads30, item.umrezBox, item.unit, 0);
  const dAds60 = formatQty(item.ads60, item.umrezBox, item.unit, 0);
  const dAds90 = formatQty(item.ads90, item.umrezBox, item.unit, 0);
  // ADS 는 판매출고 + 생산투입 합계라, 투입분이 섞인 품목만 근거를 한 줄 더 보여준다
  const dUsageAds60 = formatQty(item.usageAds60, item.umrezBox, item.unit, 0);
  const hasUsageAds = item.usageAds60 > 0;

  let displayTurnover = '-';
  if (item.ads90 > 0 && item.turnoverDays < 90000) {
    displayTurnover = `${Math.round(item.turnoverDays)}일 (${(item.turnoverDays / 30).toFixed(1)}개월)`;
  }

  return (
    <>
      <tr className="group hover:bg-[#F9F9F9] transition-colors">
        <td className={`px-3 py-3 sticky left-0 z-10 border-r border-neutral-200 ${expanded ? 'bg-blue-50' : 'bg-white group-hover:bg-[#F9F9F9]'}`}>
          <div className="flex items-start gap-1.5">
            <button
              onClick={onToggleFavorite}
              className="mt-0.5 flex-shrink-0 text-neutral-300 hover:text-yellow-400 transition-colors"
              title={isFavorite ? '즐겨찾기 제거' : '즐겨찾기 추가'}
            >
              <Star size={13} fill={isFavorite ? '#FBBF24' : 'none'} className={isFavorite ? 'text-yellow-400' : ''} />
            </button>
            <button onClick={onToggle} className="min-w-0 flex-1 text-left" title="배치(소비기한) 상세 펼치기">
              <div className="flex items-center gap-1">
                <ChevronDown size={13} className={`shrink-0 text-neutral-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                <span className="font-medium text-neutral-900 truncate" title={item.name}>{item.name}</span>
              </div>
              <div className="pl-[18px]">
                <div className="text-[11px] text-neutral-500 font-mono">{item.code}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.stockTypes.map((type) => (
                    <span key={type} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                      {INVENTORY_STOCK_TYPE_LABELS[type]}
                    </span>
                  ))}
                  {item.dispoCodes.map((dispo) => (
                    <span key={dispo} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                      {dispo}{getProductionLine(dispo) ? ` · ${getProductionLine(dispo)}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          </div>
        </td>
        {compact ? (
          <>
            {/* 재고 — 가용을 크게, 폐기·품질은 보조로 붙인다 */}
            <td className="px-3 py-3 text-right whitespace-nowrap">
              <div className="text-[15px] font-bold text-neutral-900">
                {dUsable.value} <span className="text-[10px] font-normal text-neutral-400">{dUsable.unit}</span>
              </div>
              {/* 이상이 있을 때만 보조 수치를 붙인다. '전량 가용' 같은 문구를 모든 행에 깔면 그게 노이즈다 */}
              {(item.wasteStock > 0 || (showQualityColumn && item.qualityStock > 0)) && (
                <div className="mt-0.5 flex justify-end gap-2 text-[10px] font-bold">
                  {item.wasteStock > 0 && <span className="text-[#C62828]">폐기 {dWaste.value}</span>}
                  {showQualityColumn && item.qualityStock > 0 && <span className="text-purple-700">품질 {dQuality.value}</span>}
                </div>
              )}
            </td>

            <td className="px-3 py-3 text-right whitespace-nowrap">
              <PriceCell priceSource={item.priceSource} stockValue={item.stockValue} />
            </td>

            {/* 회전일 — 아래에 ADS(60)을 붙여 '얼마나 팔리는지'를 같이 읽게 한다 */}
            <td className="px-3 py-3 text-right whitespace-nowrap">
              {item.ads90 > 0 && item.turnoverDays < 90000 ? (
                <>
                  <div className={`text-[15px] font-bold ${turnoverTone(item.turnoverDays)}`}>
                    {Math.round(item.turnoverDays)}<span className="text-[10px] font-normal text-neutral-400">일</span>
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    {(item.turnoverDays / 30).toFixed(1)}개월 · ADS60 {dAds60.value}
                  </div>
                  {hasUsageAds && (
                    <div className="text-[10px] text-amber-700" title={`ADS(60) 중 생산투입(261-262) 순소요 ${dUsageAds60.value}${dUsageAds60.unit}`}>
                      생산투입 {dUsageAds60.value}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[15px] font-bold text-neutral-300" title="최근 90일 납품출고·생산투입 실적이 모두 없어 회전일을 계산하지 않습니다">-</div>
              )}
            </td>

            <ExpiryProfileCell item={item} formatQty={formatQty} compact />
            <BucketProfileCell item={item} formatQty={formatQty} />

            <td className="px-3 py-3 text-center">
              {item.targetDatePlan > 0
                ? <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">{dPlan.value}</span>
                : <span className="text-neutral-300 text-[11px]">-</span>}
            </td>
          </>
        ) : (
          <>
            <td className="px-2 py-3 text-right text-neutral-600 bg-blue-50/20">
              {dAds30.value}
              {hasUsageAds && (
                <div className="text-[10px] text-amber-700" title="ADS 중 생산투입(261-262) 순소요분입니다">
                  투입 {formatQty(item.usageAds30, item.umrezBox, item.unit, 0).value}
                </div>
              )}
            </td>
            <td className="px-2 py-3 text-right text-neutral-800 font-medium bg-blue-50/40">
              {dAds60.value}
              {hasUsageAds && (
                <div className="text-[10px] font-normal text-amber-700" title="ADS 중 생산투입(261-262) 순소요분입니다">
                  투입 {dUsageAds60.value}
                </div>
              )}
            </td>
            <td className="px-2 py-3 text-right text-neutral-600 bg-blue-50/60">
              {dAds90.value}
              {hasUsageAds && (
                <div className="text-[10px] text-amber-700" title="ADS 중 생산투입(261-262) 순소요분입니다">
                  투입 {formatQty(item.usageAds90, item.umrezBox, item.unit, 0).value}
                </div>
              )}
            </td>
            <td className="px-2 py-3 text-center">
              {item.targetDatePlan > 0
                ? <span className="px-2 py-1 rounded bg-[#E3F2FD] text-[#1565C0] text-[11px] font-bold">{dPlan.value}</span>
                : <span className="text-neutral-300 text-[11px]">-</span>}
            </td>
            {showQualityColumn && (
              <td className="px-2 py-3 text-right font-bold text-purple-700 bg-purple-50/30">
                {item.qualityStock > 0 ? dQuality.value : '-'}
              </td>
            )}
            <td className="px-2 py-3 text-right font-bold text-green-800 bg-green-50/10">{dUsable.value}</td>
            <td className="px-2 py-3 text-right font-bold text-[#C62828] bg-red-50/30">{item.wasteStock > 0 ? dWaste.value : '-'}</td>
            <td className="px-2 py-3 text-right bg-emerald-50/20 whitespace-nowrap">
              <PriceCell priceSource={item.priceSource} stockValue={item.stockValue} />
            </td>
            <td className="px-2 py-3 text-right text-red-700 font-bold bg-red-50/10 text-xs">{displayTurnover}</td>
            <ExpiryProfileCell item={item} formatQty={formatQty} />
            {BUCKET_COLUMNS.map(({ key, className }) => (
              <BucketCell
                key={key}
                quantity={item.buckets[key]}
                stockValue={item.bucketValues[key]}
                priceSource={item.priceSource}
                displayQuantity={formatQty(item.buckets[key], item.umrezBox, item.unit).value}
                className={className}
              />
            ))}
          </>
        )}
      </tr>

      {expanded && (
        <tr>
          <td colSpan={colCount} className="p-0 bg-neutral-50 border-b-2 border-blue-100">
            {/* 요약 모드에서 접어둔 수치는 전부 여기에 있다 — 다른 화면으로 넘길 이유를 만들지 않는다 */}
            {compact && <ItemAnalysisStrip item={item} formatQty={formatQty} priceLabel={priceLabel} showQuality={showQualityColumn} />}
            <BatchDetailTable batches={item.batches} quantityMode={quantityMode} formatQty={formatQty} />
          </td>
        </tr>
      )}
    </>
  );
}

/** 펼침 영역 — 예전 재고현황 탭이 보여주던 배치별 정보를 그대로 담는다 */
function BatchDetailTable({
  batches, quantityMode, formatQty,
}: {
  batches: InventoryBoardBatchRow[];
  quantityMode: boolean;
  formatQty: FormatQty;
}) {
  const sorted = [...batches].sort((a, b) => {
    const aDays = a.remainDays ?? Number.POSITIVE_INFINITY;
    const bDays = b.remainDays ?? Number.POSITIVE_INFINITY;
    return aDays - bDays;
  });

  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold text-neutral-500 mb-2 flex items-center gap-1.5">
        <Rows3 size={12} className="text-blue-500" />
        배치(소비기한) 상세 · {sorted.length}건
      </div>
      <div className="overflow-hidden rounded border border-neutral-200 bg-white">
        <table className="w-full text-[12px] border-collapse">
          <thead className="bg-neutral-100/70 text-neutral-600">
            <tr>
              <th className="px-3 py-2 text-center font-bold w-20">상태</th>
              <th className="px-3 py-2 text-center font-bold w-24">소비기한</th>
              <th className="px-3 py-2 text-right font-bold w-20">잔여일수</th>
              <th className="px-3 py-2 text-right font-bold w-20">잔여율</th>
              <th className="px-3 py-2 text-center font-bold w-24">보관처</th>
              {quantityMode && <th className="px-3 py-2 text-left font-bold">위치정보</th>}
              <th className="px-3 py-2 text-left font-bold w-28">구분 / 라인</th>
              <th className="px-3 py-2 text-right font-bold w-28">재고수량</th>
              <th className="px-3 py-2 text-right font-bold w-32">재고금액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sorted.map((row, idx) => {
              const qty = formatQty(row.quantity, row.umrezBox, row.unit);
              return (
                <tr key={`${row.expirationDateStr}-${row.location}-${row.status}-${idx}`} className="hover:bg-blue-50/30">
                  <td className="px-3 py-2 text-center"><StatusBadge status={row.status} compact /></td>
                  <td className="px-3 py-2 text-center font-mono text-neutral-600">{row.expirationDateStr}</td>
                  <td className={`px-3 py-2 text-right font-bold ${row.status === 'disposed' ? 'text-[#C62828]' : row.remainDays === null ? 'text-neutral-400' : 'text-neutral-700'}`}>
                    {row.remainDays === null ? '-' : `${row.remainDays}일`}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.remainRate === null ? <span className="text-neutral-400">-</span> : (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.remainRate < 30 ? 'bg-[#FFEBEE] text-[#C62828]' : 'bg-[#E3F2FD] text-[#1565C0]'}`}>
                        {row.remainRate.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${row.source === 'FBH' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                      {row.source === 'FBH' ? '물류센터' : '플랜트'}
                    </span>
                  </td>
                  {quantityMode && (
                    <td className="px-3 py-2 text-neutral-600 break-keep">{row.location !== '-' ? row.location : ''}</td>
                  )}
                  <td className="px-3 py-2 text-[10px] text-neutral-500">
                    {INVENTORY_STOCK_TYPE_LABELS[row.stockType]}
                    {row.dispo ? ` · ${row.dispo}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-neutral-900">
                    {qty.value} <span className="text-[10px] font-normal text-neutral-400">{qty.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <PriceCell priceSource={row.priceSource} stockValue={row.stockValue} />
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={quantityMode ? 9 : 8} className="p-4 text-center text-neutral-400">표시할 배치가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 최단 잔여일 + 상태 구성 — '연령'을 보려고 다른 페이지로 넘어가지 않게 하는 칸 */
function ExpiryProfileCell({ item, formatQty, compact }: {
  item: InventoryBoardItemRow;
  formatQty: FormatQty;
  compact?: boolean;
}) {
  const active = INVENTORY_STATUS_ORDER.filter((status) => item.statusQty[status] > 0);
  const worst = active[0];
  const segments = active.map((status) => ({
    key: status,
    label: INVENTORY_BOARD_STATUS_LABELS[status],
    value: item.statusQty[status],
    color: STATUS_BAR_COLOR[status],
    text: formatQty(item.statusQty[status], item.umrezBox, item.unit).value,
  }));
  const risky = active.filter((status) => status === 'disposed' || status === 'imminent');

  const head = (
    <div className="flex items-center gap-1.5">
      {item.minRemainDays === null ? (
        <span className="text-[13px] font-bold text-neutral-400">기한없음</span>
      ) : (
        <>
          <span className={`text-[15px] font-bold ${remainDaysTone(item.minRemainDays)}`}>{item.minRemainDays}</span>
          <span className="text-[10px] text-neutral-400">일 남음</span>
        </>
      )}
      {worst && worst !== 'no_expiry' && <StatusBadge status={worst} compact />}
    </div>
  );

  // 요약 모드: 상태 구성을 칩 대신 막대 하나로 접는다 (칩 5개가 줄바꿈되면서 행 높이를 망가뜨렸다)
  if (compact) {
    return (
      <td className="px-3 py-3 border-l border-neutral-200 align-middle">
        <ProfileCellBody
          head={head}
          segments={segments}
          caption={
            risky.length > 0 ? (
              <span className="font-bold text-[#C62828]">
                {risky
                  .map((status) => `${INVENTORY_BOARD_STATUS_LABELS[status]} ${formatQty(item.statusQty[status], item.umrezBox, item.unit).value}`)
                  .join(' · ')}
              </span>
            ) : null
          }
        />
      </td>
    );
  }

  return (
    <td className="px-2 py-2 bg-neutral-50/60 border-l border-neutral-200 align-top">
      {head}
      <div className="mt-1 flex flex-wrap gap-1">
        {active.map((status) => (
          <span
            key={status}
            className={`rounded px-1 py-0.5 text-[10px] font-bold ${STATUS_CHIP_CLASS[status]}`}
            title={`${INVENTORY_BOARD_STATUS_LABELS[status]} 재고`}
          >
            {INVENTORY_BOARD_STATUS_LABELS[status]} {formatQty(item.statusQty[status], item.umrezBox, item.unit).value}
          </span>
        ))}
        {active.length === 0 && <span className="text-[10px] text-neutral-300">-</span>}
      </div>
    </td>
  );
}

/** 잔여율 구간 6칸을 막대 하나로 접은 칸 (요약 모드 전용) */
function BucketProfileCell({ item, formatQty }: { item: InventoryBoardItemRow; formatQty: FormatQty }) {
  const segments = BUCKET_COLUMNS
    .filter(({ key }) => item.buckets[key] > 0)
    .map(({ key, label }) => ({
      key,
      label,
      value: item.buckets[key],
      color: BUCKET_BAR_COLOR[key],
      text: formatQty(item.buckets[key], item.umrezBox, item.unit).value,
    }));

  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const top = segments.reduce<typeof segments[number] | null>(
    (best, segment) => (best === null || segment.value > best.value ? segment : best),
    null
  );
  const riskQty = item.buckets.under50;
  const riskShare = total > 0 ? Math.round((riskQty / total) * 100) : 0;

  return (
    <td className="px-3 py-3 align-middle">
      <ProfileCellBody
        head={
          riskQty > 0 ? (
            <>
              <span className="text-[13px] font-bold text-[#C62828]">~50%</span>
              <span className="text-[11px] font-bold text-[#C62828]">{formatQty(riskQty, item.umrezBox, item.unit).value}</span>
              <span className="text-[10px] text-neutral-400">({riskShare}%)</span>
            </>
          ) : top ? (
            <>
              <span className="text-[11px] text-neutral-400">최다</span>
              <span className="text-[12px] font-bold" style={{ color: top.color }}>{top.label}</span>
              <span className="text-[10px] text-neutral-400">({total > 0 ? Math.round((top.value / total) * 100) : 0}%)</span>
            </>
          ) : (
            <span className="text-[12px] text-neutral-300">-</span>
          )
        }
        segments={segments}
        caption={
          segments.length > 1 ? (
            <span className="text-neutral-400">{segments.length}개 구간 분포</span>
          ) : null
        }
      />
    </td>
  );
}

/**
 * 유통기한 칸과 잔여율 칸의 막대가 같은 높이에 오도록 3단(라벨·막대·캡션)을 고정한다.
 * 셀마다 내용 줄 수가 달라서 막대 y좌표가 어긋나 보이던 것을 막는다.
 */
function ProfileCellBody({ head, segments, caption }: {
  head: React.ReactNode;
  segments: Array<{ key: string; label: string; value: number; color: string; text: string }>;
  caption: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex h-[20px] items-center gap-1.5">{head}</div>
      <MiniStackBar segments={segments} />
      <div className="flex h-[15px] items-center text-[10px] truncate">{caption}</div>
    </div>
  );
}

/**
 * 구성비 막대. 구획 경계를 흰 선으로 끊어 색이 몇 갈래인지 한눈에 보이게 한다.
 * 색은 위험도 순서 그대로다 — 빨강(가장 위험) → 주황 → 노랑 → 파랑 → 초록(가장 안전), 회색은 기한없음.
 */
function MiniStackBar({ segments }: {
  segments: Array<{ key: string; label: string; value: number; color: string; text: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return <div className="my-1 h-2 rounded-full bg-neutral-100" />;

  return (
    <div
      className="my-1 flex h-2 w-full overflow-hidden rounded-full bg-neutral-100"
      title={segments
        .map((segment) => `${segment.label} ${segment.text} (${Math.round((segment.value / total) * 100)}%)`)
        .join('\n')}
    >
      {segments.map((segment, idx) => (
        <div
          key={segment.key}
          style={{
            width: `${(segment.value / total) * 100}%`,
            // 비중 1% 미만이라도 보이게 최소 폭을 준다 — 폐기 24개가 안 보이면 막대를 둘 이유가 없다
            minWidth: '4px',
            backgroundColor: segment.color,
            borderRight: idx < segments.length - 1 ? '1px solid #fff' : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** 막대 색 범례 — 색만 칠해두고 뜻을 안 적으면 그건 장식이다 */
function BarLegend() {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200/70 pt-2 text-[10px] text-neutral-500">
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-neutral-600">유통기한</span>
        {INVENTORY_STATUS_ORDER.map((status) => (
          <span key={status} className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: STATUS_BAR_COLOR[status] }} />
            {INVENTORY_BOARD_STATUS_LABELS[status]}
          </span>
        ))}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-neutral-600">잔여율</span>
        {BUCKET_COLUMNS.map(({ key, label }) => (
          <span key={key} className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: BUCKET_BAR_COLOR[key] }} />
            {label.replace(' (유효)', '')}
          </span>
        ))}
      </span>
    </div>
  );
}

/** 요약 모드에서 접어둔 수치 전부 — 펼침 영역 상단에 붙는다 */
function ItemAnalysisStrip({ item, formatQty, priceLabel, showQuality }: {
  item: InventoryBoardItemRow;
  formatQty: FormatQty;
  priceLabel: string;
  showQuality: boolean;
}) {
  const qty = (value: number) => formatQty(value, item.umrezBox, item.unit).value;
  /** ADS 는 일평균이라 소수점이 길게 붙는다. 표의 ADS 열과 같이 정수로 끊는다 */
  const adsQty = (value: number) => formatQty(value, item.umrezBox, item.unit, 0).value;
  const priced = item.priceSource === 'ENDING_INVENTORY';

  return (
    <div className="px-4 pt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
      {/* ADS 는 판매출고 + 생산투입 합계라, 근거가 되는 두 갈래를 여기서 나눠 보여준다 */}
      <StripBlock title="소진속도 · 회전 (판매출고 + 생산투입)">
        <StripFigure label="ADS(30)" value={adsQty(item.ads30)} sub={`판매 ${adsQty(item.ads30 - item.usageAds30)} · 투입 ${adsQty(item.usageAds30)}`} />
        <StripFigure label="ADS(60)" value={adsQty(item.ads60)} sub={`판매 ${adsQty(item.ads60 - item.usageAds60)} · 투입 ${adsQty(item.usageAds60)}`} />
        <StripFigure label="ADS(90)" value={adsQty(item.ads90)} sub={`판매 ${adsQty(item.ads90 - item.usageAds90)} · 투입 ${adsQty(item.usageAds90)}`} />
        <StripFigure
          label="회전일(90)"
          value={item.ads90 > 0 && item.turnoverDays < 90000 ? `${Math.round(item.turnoverDays)}일` : '-'}
          sub="가용재고 ÷ ADS(90)"
        />
      </StripBlock>

      <StripBlock title="유통기한 상태별 재고">
        {INVENTORY_STATUS_ORDER.map((status) => (
          <StripFigure
            key={status}
            label={INVENTORY_BOARD_STATUS_LABELS[status]}
            value={qty(item.statusQty[status])}
            muted={item.statusQty[status] <= 0}
          />
        ))}
        {showQuality && <StripFigure label="품질대기" value={qty(item.qualityStock)} muted={item.qualityStock <= 0} />}
      </StripBlock>

      <StripBlock title={`잔여율 구간별 재고 · 금액 (${priceLabel} 단가)`}>
        {BUCKET_COLUMNS.map(({ key, label }) => (
          <StripFigure
            key={key}
            label={label}
            value={qty(item.buckets[key])}
            sub={priced ? `${Math.round(item.bucketValues[key]).toLocaleString('ko-KR')}원` : '금액 미산정'}
            muted={item.buckets[key] <= 0}
          />
        ))}
      </StripBlock>
    </div>
  );
}

function StripBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-3">
      <div className="text-[11px] font-bold text-neutral-500 mb-2">{title}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">{children}</div>
    </div>
  );
}

function StripFigure({ label, value, sub, muted }: { label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <div className={muted ? 'opacity-40' : ''}>
      <div className="text-[10px] text-neutral-400">{label}</div>
      <div className="text-[13px] font-bold text-neutral-900 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-neutral-400 leading-tight">{sub}</div>}
    </div>
  );
}

function remainDaysTone(days: number) {
  if (days <= 0) return 'text-[#C62828]';
  if (days <= 30) return 'text-[#E65100]';
  if (days <= 60) return 'text-[#F57F17]';
  return 'text-[#1565C0]';
}

/** 회전일이 길수록 악성재고다 */
function turnoverTone(days: number) {
  if (days > 90) return 'text-[#C62828]';
  if (days > 45) return 'text-[#E65100]';
  return 'text-neutral-900';
}

const STATUS_CHIP_CLASS: Record<InventoryRiskStatus, string> = {
  disposed: 'bg-[#FFEBEE] text-[#C62828]',
  imminent: 'bg-[#FFF3E0] text-[#E65100]',
  critical: 'bg-[#FFF8E1] text-[#F57F17]',
  healthy: 'bg-[#E3F2FD] text-[#1565C0]',
  no_expiry: 'bg-neutral-100 text-neutral-500',
};

const STATUS_BAR_COLOR: Record<InventoryRiskStatus, string> = {
  disposed: '#E53935',
  imminent: '#FB8C00',
  critical: '#FBC02D',
  healthy: '#42A5F5',
  no_expiry: '#BDBDBD',
};

const BUCKET_BAR_COLOR: Record<keyof InventoryBoardBuckets, string> = {
  under50: '#E53935',
  r50_70: '#FB8C00',
  r70_75: '#FBC02D',
  r75_85: '#42A5F5',
  over85: '#66BB6A',
  noExpiry: '#BDBDBD',
};

function BucketCell({
  quantity, stockValue, priceSource, displayQuantity, className,
}: {
  quantity: number;
  stockValue: number;
  priceSource: PriceSource;
  displayQuantity: string;
  className: string;
}) {
  if (quantity <= 0) {
    return <td className={`px-2 py-3 text-right font-medium ${className}`}>-</td>;
  }

  return (
    <td className={`px-2 py-2 text-right font-medium whitespace-nowrap ${className}`}>
      <div>{displayQuantity}</div>
      {priceSource === 'ENDING_INVENTORY' ? (
        <div className="mt-0.5 text-[10px] font-normal leading-none text-neutral-500">
          {Math.round(stockValue).toLocaleString('ko-KR')}원
        </div>
      ) : (
        <div
          className="mt-0.5 text-[10px] font-normal leading-none text-amber-700"
          title={priceSource === 'CURRENT_MONTH' ? '당월 첫 생산분으로 기말재고 단가가 아직 없습니다.' : '적용 가능한 기말재고 단가가 없습니다.'}
        >
          금액 미산정
        </div>
      )}
    </td>
  );
}

/** 열이 많은 상세 모드에서 헤더가 한 글자씩 세로로 쪼개지지 않도록 whitespace-nowrap 을 항상 건다 */
function SortableHeader({ label, sortKey, currentSort, onSort, align = 'left', width, className = '', tooltip }: {
  label: string;
  sortKey: SortKey;
  currentSort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right' | 'center';
  width?: string;
  className?: string;
  tooltip?: string;
}) {
  const isActive = currentSort.key === sortKey;
  return (
    <th
      className={`px-2 py-3 border-b font-bold text-neutral-700 cursor-pointer select-none whitespace-nowrap hover:bg-neutral-100 transition-colors ${className}`}
      style={{ textAlign: align, width, minWidth: width }}
      onClick={() => onSort(sortKey)}
    >
      <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
        {label}
        {tooltip && <span onClick={(e) => e.stopPropagation()}><InfoTooltip text={tooltip} /></span>}
        {isActive
          ? (currentSort.direction === 'asc' ? <ArrowUp size={12} className="text-primary-blue" /> : <ArrowDown size={12} className="text-primary-blue" />)
          : <ArrowUpDown size={12} className="text-neutral-300" />}
      </div>
    </th>
  );
}

function TabButton({ label, active, onClick, color }: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-bold transition-all whitespace-nowrap ${
        active ? 'bg-white shadow-sm text-neutral-900 border border-neutral-200/50' : 'text-neutral-500 hover:text-neutral-700'
      }`}
    >
      <span className={active && color ? color : ''}>{label}</span>
    </button>
  );
}

function StatusBadge({ status, compact }: { status: InventoryBoardStatus; compact?: boolean }) {
  const config: Record<InventoryBoardStatus, { bg: string; text: string }> = {
    healthy: { bg: '#E3F2FD', text: '#1E88E5' },
    critical: { bg: '#FFF8E1', text: '#F57F17' },
    imminent: { bg: '#FFF3E0', text: '#E65100' },
    disposed: { bg: '#FFEBEE', text: '#E53935' },
    no_expiry: { bg: '#F5F5F5', text: '#757575' },
    quality_hold: { bg: '#F3E5F5', text: '#7B1FA2' },
  };
  const c = config[status];
  return (
    <span
      className={`rounded font-bold border border-transparent ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {INVENTORY_BOARD_STATUS_LABELS[status]}
    </span>
  );
}

/** 단가가 없는 자재는 0원으로 뭉개지 않고 "당월생산"으로 구분해 보여준다. */
function PriceCell({ priceSource, stockValue }: { priceSource: PriceSource; stockValue: number }) {
  if (priceSource === 'ENDING_INVENTORY') {
    return <span className="font-bold text-emerald-800">{Math.round(stockValue).toLocaleString()}원</span>;
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

function describePriceSource(priceSource: PriceSource, priceLabel: string) {
  if (priceSource === 'ENDING_INVENTORY') return priceLabel;
  if (priceSource === 'CURRENT_MONTH') return '당월생산';
  return '단가없음';
}

const KPI_TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
} as const;

function ValueKpiCard({ icon: Icon, tone, label, value, sub }: {
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

/**
 * 평균 소진속도(ADS) 3구간을 카드 한 장에 담는다 — 카드 3장으로 펴면 헤더가 두 줄이 된다.
 * 합계 안에 생산투입분이 얼마나 섞였는지 밑줄로 같이 보여준다(판매만 보고 오해하지 않게).
 */
function AdsSummaryCard({ ads30, ads60, ads90, usageAds30, usageAds60, usageAds90, unitMode }: {
  ads30: number;
  ads60: number;
  ads90: number;
  usageAds30: number;
  usageAds60: number;
  usageAds90: number;
  unitMode: string;
}) {
  const fmt = (value: number) => unitMode === 'BOX'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : Math.round(value).toLocaleString();

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-4 flex gap-3">
      <div className="h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center bg-neutral-50 text-neutral-500 border-neutral-200">
        <BarChart3 size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-neutral-500" title={ADS_BASIS_TEXT}>
          평균 소진속도 (Total ADS · {unitMode === 'BOX' ? 'BOX' : 'EA/KG'}/일)
        </div>
        <div className="mt-1 flex gap-4">
          {[
            { label: '30일', value: ads30, usage: usageAds30 },
            { label: '60일', value: ads60, usage: usageAds60 },
            { label: '90일', value: ads90, usage: usageAds90 },
          ].map(({ label, value, usage }) => (
            <div key={label}>
              <div className="text-[10px] text-neutral-400">{label}</div>
              <div className="text-[15px] font-bold text-neutral-900 leading-tight">{fmt(value)}</div>
              {usage > 0 && (
                <div className="text-[10px] text-amber-700 leading-tight" title="이 중 생산투입(261-262) 순소요분">
                  투입 {fmt(usage)}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="text-[10px] text-neutral-400 mt-1">판매출고 + 생산투입(261-262)</div>
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

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-100px)]">
      <div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div>
    </div>
  );
}

export default function InventoryBoardPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <InventoryBoardPageInner />
    </Suspense>
  );
}
