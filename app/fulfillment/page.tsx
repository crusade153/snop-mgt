'use client'

import { useState, useMemo, Suspense } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { useFavorites } from '@/hooks/use-favorites';
import {
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  AlertCircle,
  Clock,
  Search,
  TrendingUp,
  CircleDollarSign,
  Share2,
  Users,
  Package,
  Star
} from 'lucide-react';
import { CustomerStat, IntegratedItem } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store';
import { exportToExcel } from '@/lib/excel-export';
import { Download } from 'lucide-react';

// WideRightSheet (800px)
function WideRightSheet({ isOpen, onClose, title, children }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30 transition-opacity" onClick={onClose} />
      <div className="relative w-[800px] h-full bg-white shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-6 border-b border-neutral-200 bg-neutral-50">
            <h2 className="text-xl font-bold text-neutral-900">{title}</h2>
            <button onClick={onClose} className="p-2 hover:bg-neutral-200 rounded-full text-neutral-500">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 bg-[#F9FAFB]">{children}</div>
        </div>
      </div>
    </div>
  );
}

function FulfillmentPageInner() {
  const { data, isLoading } = useDashboardData();
  const { unitMode, favoritesOnly } = useUiStore();
  const { isFavorite } = useFavorites();
  const { getParam, getIntParam, setParams, copyShareUrl } = useUrlFilters();

  const searchTerm = getParam('search', '');
  const currentPage = getIntParam('page', 1);
  const setSearchTerm = (v: string) => setParams({ search: v || null, page: null });
  const setCurrentPage = (p: number) => setParams({ page: p > 1 ? String(p) : null });

  // 즐겨찾기 ON이면 제품별 탭 자동 활성화
  const [activeTab, setActiveTab] = useState<'customer' | 'product'>('customer');
  const currentTab = favoritesOnly ? 'product' : activeTab;

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerStat | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<IntegratedItem | null>(null);

  const itemsPerPage = 15;

  // ── 거래처별 데이터 ──
  const filteredCustomerData = useMemo(() => {
    const byCustomer = data?.fulfillment?.byCustomer || [];
    const filtered = byCustomer.filter((cust: CustomerStat) =>
      cust.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.id.includes(searchTerm)
    );
    const totalRevenue = filtered.reduce((acc, cur) => acc + cur.totalRevenue, 0);
    const totalMissed = filtered.reduce((acc, cur) => acc + cur.missedRevenue, 0);
    const totalOrders = filtered.reduce((acc, cur) => acc + cur.orderCount, 0);
    const totalUnfulfilled = filtered.reduce((acc, cur) => acc + (cur.orderCount - cur.fulfilledCount), 0);
    return {
      list: filtered.sort((a, b) => b.totalRevenue - a.totalRevenue),
      summary: { revenue: totalRevenue, missed: totalMissed, orders: totalOrders, unfulfilled: totalUnfulfilled }
    };
  }, [data, searchTerm]);

  // ── 제품별 데이터 ──
  const filteredProductData = useMemo(() => {
    const items: IntegratedItem[] = data?.integratedArray || [];
    const filtered = items
      .filter((item) =>
        item.totalReqQty > 0 &&
        (!favoritesOnly || isFavorite(item.code)) &&
        (item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.code.includes(searchTerm))
      )
      .sort((a, b) => b.totalSalesAmount - a.totalSalesAmount);

    const totalSales = filtered.reduce((acc, cur) => acc + cur.totalSalesAmount, 0);
    const totalMissed = filtered.reduce((acc, cur) => acc + cur.totalUnfulfilledValue, 0);
    const avgRate = filtered.length > 0
      ? filtered.reduce((acc, cur) => acc + (cur.totalReqQty > 0 ? (cur.totalActualQty / cur.totalReqQty) * 100 : 100), 0) / filtered.length
      : 0;

    return { list: filtered, summary: { sales: totalSales, missed: totalMissed, avgRate, count: filtered.length } };
  }, [data, searchTerm, favoritesOnly, isFavorite]);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  const formatQty = (val: number, conversion: number, baseUnit: string) => {
    if (unitMode === 'BOX') {
      const boxes = val / (conversion > 0 ? conversion : 1);
      return { value: boxes.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: 'BOX' };
    }
    return { value: val.toLocaleString(), unit: baseUnit };
  };

  // ── 거래처별 페이징 ──
  const totalCustomerPages = Math.ceil(filteredCustomerData.list.length / itemsPerPage);
  const paginatedCustomers = filteredCustomerData.list.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // ── 제품별 페이징 ──
  const totalProductPages = Math.ceil(filteredProductData.list.length / itemsPerPage);
  const paginatedProducts = filteredProductData.list.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTabChange = (tab: 'customer' | 'product') => {
    setActiveTab(tab);
    setParams({ page: null });
  };

  const handleDownloadExcel = () => {
    if (currentTab === 'customer') {
      const rows = filteredCustomerData.list.map((c) => ({
        '거래처명': c.name,
        '거래처코드': c.id,
        '주문건수': c.orderCount,
        '납품완료': c.fulfilledCount,
        '매출액(원)': c.totalRevenue,
        '미납손실(원)': c.missedRevenue,
        '납품률(%)': c.fulfillmentRate.toFixed(1),
      }));
      exportToExcel(rows, '납품현황_거래처별');
    } else {
      const rows = filteredProductData.list.map((item) => {
        const rate = item.totalReqQty > 0 ? (item.totalActualQty / item.totalReqQty) * 100 : 100;
        return {
          '제품명': item.name,
          '제품코드': item.code,
          '총 요청수량': item.totalReqQty,
          '납품수량': item.totalActualQty,
          '납품률(%)': rate.toFixed(1),
          '매출액(원)': item.totalSalesAmount,
          '미납손실(원)': item.totalUnfulfilledValue,
          '현재재고': item.inventory.totalStock,
        };
      });
      exportToExcel(rows, '납품현황_제품별');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* 헤더 */}
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">✅ 납품 현황 (Fulfillment)</h1>
          <p className="text-[12px] text-neutral-700 mt-1">거래처별 · 제품별 납품 준수율 및 매출 실시간 분석</p>
        </div>
        <div className="flex gap-2 items-center w-full md:w-auto flex-wrap">
          <button
            onClick={handleDownloadExcel}
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold rounded-xl border bg-white text-green-700 border-green-200 hover:bg-green-50"
          >
            <Download size={14} />
            엑셀 다운로드
          </button>
          <div className="relative flex-1 md:w-80">
            <input
              type="text"
              placeholder={currentTab === 'customer' ? "거래처명 또는 코드 검색..." : "제품명 또는 코드 검색..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-neutral-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue bg-white shadow-sm transition-all"
            />
            <Search className="absolute left-3 top-3 text-neutral-400" size={18} />
          </div>
          <button
            onClick={copyShareUrl}
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold rounded-xl border bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            title="현재 필터 상태 URL 복사"
          >
            <Share2 size={14} />
            뷰 공유
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => handleTabChange('customer')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            currentTab === 'customer'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <ShoppingBag size={13} />
          거래처별
        </button>
        <button
          onClick={() => handleTabChange('product')}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            currentTab === 'product'
              ? 'bg-white text-neutral-900 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Package size={13} />
          제품별
          {favoritesOnly && (
            <span className="ml-1 flex items-center gap-0.5 text-yellow-600">
              <Star size={10} fill="currentColor" />
            </span>
          )}
        </button>
      </div>

      {/* ── 거래처별 탭 ── */}
      {currentTab === 'customer' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiBox label={searchTerm ? "검색 거래처 매출 합계" : "총 납품 매출액"} value={Math.round(filteredCustomerData.summary.revenue / 1000000).toLocaleString()} unit="백만원" type="blue" icon={CircleDollarSign} />
            <KpiBox label="미납 기회손실" value={Math.round(filteredCustomerData.summary.missed / 1000000).toLocaleString()} unit="백만원" type="brand" icon={AlertCircle} />
            <KpiBox label="주문 이행률" value={filteredCustomerData.summary.orders > 0 ? ((1 - (filteredCustomerData.summary.unfulfilled / filteredCustomerData.summary.orders)) * 100).toFixed(1) : "0.0"} unit="%" type="success" icon={TrendingUp} />
            <KpiBox label="거래처 수" value={filteredCustomerData.list.length.toLocaleString()} unit="개사" type="neutral" icon={ShoppingBag} />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-5 border-b border-neutral-200 bg-white flex justify-between items-center">
              <h2 className="text-[16px] font-bold text-neutral-800">🏢 거래처별 납품 성과 (매출순)</h2>
            </div>
            <div className="overflow-x-auto min-h-[500px]">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-4 border-b text-center w-16 font-bold text-neutral-600 text-[11px]">No</th>
                    <th className="px-4 py-4 border-b font-bold text-neutral-600 text-[11px]">거래처명</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">총 주문</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">총 매출액</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">미납 손실</th>
                    <th className="px-4 py-4 border-b text-center font-bold text-neutral-600 text-[11px]">준수율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {paginatedCustomers.map((cust: CustomerStat, idx: number) => {
                    const rowNo = (currentPage - 1) * itemsPerPage + idx + 1;
                    return (
                      <tr key={cust.id} onClick={() => setSelectedCustomer(cust)} className="hover:bg-blue-50/50 transition-colors cursor-pointer h-[52px]">
                        <td className="px-4 py-3 text-center text-neutral-400 font-mono text-xs">{rowNo}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-neutral-900">{cust.name}</div>
                          <div className="text-[11px] text-neutral-400 font-mono">{cust.id}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-neutral-600">{cust.orderCount.toLocaleString()}건</td>
                        <td className="px-4 py-3 text-right font-bold text-neutral-900">{Math.round(cust.totalRevenue / 1000000).toLocaleString()}백만</td>
                        <td className={`px-4 py-3 text-right font-bold ${cust.missedRevenue > 0 ? 'text-[#E53935]' : 'text-neutral-300'}`}>
                          {cust.missedRevenue > 0 ? `${Math.round(cust.missedRevenue / 1000000).toLocaleString()}백만` : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${cust.fulfillmentRate >= 95 ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                            {cust.fulfillmentRate.toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalCustomerPages > 1 && (
              <div className="flex justify-center items-center gap-4 p-5 border-t border-neutral-200 bg-neutral-50/50">
                <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span className="text-sm font-bold text-neutral-700">{currentPage} / {totalCustomerPages}</span>
                <button onClick={() => handlePageChange(Math.min(totalCustomerPages, currentPage + 1))} disabled={currentPage === totalCustomerPages} className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 제품별 탭 ── */}
      {currentTab === 'product' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiBox label="총 매출액" value={Math.round(filteredProductData.summary.sales / 1000000).toLocaleString()} unit="백만원" type="blue" icon={CircleDollarSign} />
            <KpiBox label="미납 기회손실" value={Math.round(filteredProductData.summary.missed / 1000000).toLocaleString()} unit="백만원" type="brand" icon={AlertCircle} />
            <KpiBox label="평균 납품률" value={filteredProductData.summary.avgRate.toFixed(1)} unit="%" type="success" icon={TrendingUp} />
            <KpiBox label={favoritesOnly ? "즐겨찾기 제품" : "제품 수"} value={filteredProductData.summary.count.toLocaleString()} unit="개" type="neutral" icon={favoritesOnly ? Star : Package} />
          </div>

          {favoritesOnly && filteredProductData.list.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
              <Star size={24} className="text-yellow-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-yellow-800">즐겨찾기 제품이 없습니다</p>
              <p className="text-xs text-yellow-600 mt-1">제품 상세 페이지에서 ★을 눌러 즐겨찾기를 등록하세요</p>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-5 border-b border-neutral-200 bg-white flex justify-between items-center">
              <h2 className="text-[16px] font-bold text-neutral-800">
                📦 제품별 납품 성과 (매출순)
                {favoritesOnly && <span className="ml-2 text-xs text-yellow-600 font-normal">★ 즐겨찾기 제품만 표시</span>}
              </h2>
            </div>
            <div className="overflow-x-auto min-h-[500px]">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-4 border-b text-center w-14 font-bold text-neutral-600 text-[11px]">No</th>
                    <th className="px-4 py-4 border-b font-bold text-neutral-600 text-[11px]">제품명</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">요청/납품수량</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">매출액</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">미납손실</th>
                    <th className="px-4 py-4 border-b text-center font-bold text-neutral-600 text-[11px]">납품률</th>
                    <th className="px-4 py-4 border-b text-right font-bold text-neutral-600 text-[11px]">현재재고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {paginatedProducts.map((item: IntegratedItem, idx: number) => {
                    const rowNo = (currentPage - 1) * itemsPerPage + idx + 1;
                    const rate = item.totalReqQty > 0 ? (item.totalActualQty / item.totalReqQty) * 100 : 100;
                    const reqQty = formatQty(item.totalReqQty, item.umrezBox, item.unit);
                    const actQty = formatQty(item.totalActualQty, item.umrezBox, item.unit);
                    const stockQty = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                    const isFav = isFavorite(item.code);
                    return (
                      <tr key={item.code} onClick={() => setSelectedProduct(item)} className="hover:bg-blue-50/50 transition-colors cursor-pointer h-[52px]">
                        <td className="px-4 py-3 text-center text-neutral-400 font-mono text-xs">{rowNo}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {isFav && <Star size={11} className="text-yellow-500 shrink-0" fill="currentColor" />}
                            <span className="font-bold text-neutral-900 line-clamp-2 leading-tight">{item.name}</span>
                          </div>
                          <div className="text-[11px] text-neutral-400 font-mono mt-0.5">{item.code}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-neutral-500">
                          <span className="text-neutral-400">{reqQty.value}</span>
                          <span className="mx-1 text-neutral-300">/</span>
                          <span className="font-bold text-neutral-700">{actQty.value}</span>
                          <span className="text-[10px] text-neutral-400 ml-0.5">{actQty.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-neutral-900">{Math.round(item.totalSalesAmount / 1000000).toLocaleString()}백만</td>
                        <td className={`px-4 py-3 text-right font-bold ${item.totalUnfulfilledValue > 0 ? 'text-[#E53935]' : 'text-neutral-300'}`}>
                          {item.totalUnfulfilledValue > 0 ? `${Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()}백만` : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${rate >= 95 ? 'bg-blue-50 text-blue-700' : rate >= 80 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'}`}>
                            {rate.toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold text-xs ${item.inventory.totalStock === 0 ? 'text-red-500' : 'text-neutral-700'}`}>
                            {stockQty.value}
                          </span>
                          <span className="text-[10px] text-neutral-400 ml-0.5">{stockQty.unit}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalProductPages > 1 && (
              <div className="flex justify-center items-center gap-4 p-5 border-t border-neutral-200 bg-neutral-50/50">
                <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span className="text-sm font-bold text-neutral-700">{currentPage} / {totalProductPages}</span>
                <button onClick={() => handlePageChange(Math.min(totalProductPages, currentPage + 1))} disabled={currentPage === totalProductPages} className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 거래처 상세 시트 ── */}
      <WideRightSheet isOpen={!!selectedCustomer} onClose={() => setSelectedCustomer(null)} title={selectedCustomer?.name || '상세 정보'}>
        {selectedCustomer && (
          <div className="space-y-8">
            <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
              <span className="text-xs text-neutral-500 font-mono">{selectedCustomer.id}</span>
              <h3 className="text-xl font-bold text-neutral-900 mt-1">{selectedCustomer.name}</h3>
              <div className="mt-4 pt-4 border-t border-neutral-100 flex justify-between">
                <span className="text-sm text-neutral-500">누적 미납 손실액</span>
                <span className="text-xl font-bold text-red-600">{Math.round(selectedCustomer.missedRevenue / 1000000).toLocaleString()}백만원</span>
              </div>
            </div>
            <div>
              <h3 className="font-bold text-neutral-900 mb-4 flex items-center gap-2 text-lg"><ShoppingBag size={20} className="text-blue-500" /> 주요 구매 품목</h3>
              <div className="bg-white border border-neutral-200 rounded-2xl p-2">
                {selectedCustomer.topBoughtProducts.map((p, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 border-b border-neutral-100 last:border-0">
                    <span className="text-sm font-bold text-neutral-800">{p.name}</span>
                    <span className="font-bold text-neutral-900">{Math.round(p.value / 1000000).toLocaleString()}백만</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </WideRightSheet>

      {/* ── 제품 상세 시트 ── */}
      <WideRightSheet isOpen={!!selectedProduct} onClose={() => setSelectedProduct(null)} title="제품 납품 상세 (Deep Dive)">
        {selectedProduct && (() => {
          const rate = selectedProduct.totalReqQty > 0 ? (selectedProduct.totalActualQty / selectedProduct.totalReqQty) * 100 : 100;
          const coverageDays = selectedProduct.inventory.ads > 0 ? selectedProduct.inventory.totalStock / selectedProduct.inventory.ads : 0;
          return (
            <div className="space-y-8">
              {/* 상단 요약 */}
              <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="inline-block px-2 py-1 rounded bg-neutral-100 text-neutral-500 text-xs font-mono mb-2">{selectedProduct.code}</span>
                    <h3 className="text-lg font-bold text-neutral-900 leading-snug">{selectedProduct.name}</h3>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-neutral-500 mb-1">납품률</div>
                    <div className={`text-2xl font-bold ${rate >= 95 ? 'text-blue-600' : rate >= 80 ? 'text-yellow-600' : 'text-red-600'}`}>{rate.toFixed(1)}%</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-neutral-100 pt-4">
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">총 요청 수량</div>
                    <div className="font-bold text-neutral-800 text-sm">
                      {formatQty(selectedProduct.totalReqQty, selectedProduct.umrezBox, selectedProduct.unit).value}
                      <span className="text-xs font-normal text-neutral-400 ml-1">{formatQty(selectedProduct.totalReqQty, selectedProduct.umrezBox, selectedProduct.unit).unit}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">납품 수량</div>
                    <div className="font-bold text-blue-700 text-sm">
                      {formatQty(selectedProduct.totalActualQty, selectedProduct.umrezBox, selectedProduct.unit).value}
                      <span className="text-xs font-normal text-neutral-400 ml-1">{formatQty(selectedProduct.totalActualQty, selectedProduct.umrezBox, selectedProduct.unit).unit}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">현재 재고</div>
                    <div className={`font-bold text-sm ${selectedProduct.inventory.totalStock === 0 ? 'text-red-500' : 'text-neutral-800'}`}>
                      {formatQty(selectedProduct.inventory.totalStock, selectedProduct.umrezBox, selectedProduct.unit).value}
                      <span className="text-xs font-normal text-neutral-400 ml-1">{formatQty(selectedProduct.inventory.totalStock, selectedProduct.umrezBox, selectedProduct.unit).unit}</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">
                      플랜트 {formatQty(selectedProduct.inventory.plantStock, selectedProduct.umrezBox, selectedProduct.unit).value} / FBH {formatQty(selectedProduct.inventory.fbhStock, selectedProduct.umrezBox, selectedProduct.unit).value}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-neutral-500 mb-1">판매속도 (ADS)</div>
                    <div className="font-bold text-neutral-800 text-sm">
                      {formatQty(selectedProduct.inventory.ads, selectedProduct.umrezBox, selectedProduct.unit).value}
                      <span className="text-xs font-normal text-neutral-400 ml-1">{formatQty(selectedProduct.inventory.ads, selectedProduct.umrezBox, selectedProduct.unit).unit}/일</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* S&OP 인사이트 */}
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
                <Clock className="text-blue-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <h4 className="font-bold text-blue-900 text-sm mb-1">S&OP 인사이트</h4>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    {rate >= 95
                      ? `납품률 ${rate.toFixed(1)}%로 양호합니다. 현재 재고로 약 ${coverageDays.toFixed(0)}일 운영 가능합니다.`
                      : `납품률 ${rate.toFixed(1)}%로 주의가 필요합니다. 미납 기회손실 ${Math.round(selectedProduct.totalUnfulfilledValue / 1000000).toLocaleString()}백만원이 발생했습니다.`}
                    {selectedProduct.inventory.totalStock === 0
                      ? ' 재고가 고갈되어 즉시 생산 투입이 필요합니다.'
                      : coverageDays < 7
                      ? ` 재고 커버리지 ${coverageDays.toFixed(0)}일로 긴급 보충이 필요합니다.`
                      : ''}
                  </p>
                </div>
              </div>

              {/* 미납 대기 거래처 */}
              {selectedProduct.unfulfilledOrders.length > 0 && (
                <div>
                  <h3 className="font-bold text-neutral-900 mb-3 flex items-center gap-2">
                    <Users size={18} className="text-neutral-500" /> 미납 대기 거래처 ({selectedProduct.unfulfilledOrders.length}곳)
                  </h3>
                  <div className="space-y-3">
                    {selectedProduct.unfulfilledOrders
                      .sort((a, b) => b.qty - a.qty)
                      .map((order, idx) => {
                        const dQty = formatQty(order.qty, selectedProduct.umrezBox, selectedProduct.unit);
                        return (
                          <div key={idx} className="bg-white border border-neutral-200 rounded-lg p-4 shadow-sm hover:border-red-200 transition-colors">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-bold text-neutral-800 text-sm">{order.place}</div>
                              <span className="bg-red-50 text-red-600 text-[11px] px-2 py-1 rounded font-bold border border-red-100">
                                {dQty.value} {dQty.unit} 미납
                              </span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-neutral-500 mt-2 pt-2 border-t border-neutral-100">
                              <span>요청일: <span className="font-mono text-neutral-700">{order.reqDate}</span></span>
                              <span className="font-bold text-red-500 flex items-center gap-1">
                                <Clock size={12} /> +{order.daysDelayed}일 지연
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </WideRightSheet>
    </div>
  );
}

export default function FulfillmentPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>}>
      <FulfillmentPageInner />
    </Suspense>
  );
}

function KpiBox({ label, value, unit, type, icon: Icon }: any) {
  const styles: any = {
    brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]', icon: 'text-[#E53935]' },
    blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]', icon: 'text-[#1E88E5]' },
    success: { bg: 'bg-[#E8F5E9]', text: 'text-[#2E7D32]', label: 'text-[#43A047]', icon: 'text-[#2E7D32]' },
    neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]', label: 'text-[#757575]', icon: 'text-neutral-400' },
  };
  const s = styles[type] || styles.neutral;
  return (
    <div className={`p-5 rounded-2xl border border-neutral-200 ${s.bg} shadow-sm`}>
      <div className="flex justify-between items-start mb-2">
        <div className={`text-[11px] font-bold uppercase tracking-wider ${s.label}`}>{label}</div>
        <Icon size={16} className={s.icon} />
      </div>
      <div className={`text-[24px] font-bold ${s.text}`}>{value}<span className="text-[13px] font-normal ml-1 opacity-70">{unit}</span></div>
    </div>
  );
}

function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-10 h-10 border-4 border-neutral-200 border-t-primary-brand rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-20 text-center text-[#E53935] font-bold">데이터 로드 실패</div>; }
