'use client'

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useDashboardData } from '@/hooks/use-dashboard';
import { useUrlFilters } from '@/hooks/use-url-filters';
import { 
  ChevronLeft, 
  ChevronRight, 
  ShoppingBag, 
  AlertCircle, 
  Clock,
  Search,
  TrendingUp,
  CircleDollarSign,
  Share2
} from 'lucide-react';
import { CustomerStat } from '@/types/analysis';
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
  // 1. 모든 데이터 페칭 및 상태 훅을 최상단에 배치 (Rule of Hooks 준수)
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore();
  const { getParam, getIntParam, setParams, copyShareUrl } = useUrlFilters();

  const searchTerm = getParam('search', '');
  const currentPage = getIntParam('page', 1);
  const setSearchTerm = (v: string) => setParams({ search: v || null, page: null });
  const setCurrentPage = (p: number) => setParams({ page: p > 1 ? String(p) : null });

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerStat | null>(null);

  const itemsPerPage = 15;

  // 2. 검색 및 KPI 계산 로직 (data가 없을 경우를 대비해 옵셔널 체이닝 사용)
  const filteredData = useMemo(() => {
    const byCustomer = data?.fulfillment?.byCustomer || [];
    
    // 거래처명 또는 ID로 필터링
    const filtered = byCustomer.filter((cust: CustomerStat) => 
      cust.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.id.includes(searchTerm)
    );

    // 필터링된 결과 기반 실시간 KPI 합산
    const totalRevenue = filtered.reduce((acc, cur) => acc + cur.totalRevenue, 0);
    const totalMissed = filtered.reduce((acc, cur) => acc + cur.missedRevenue, 0);
    const totalOrders = filtered.reduce((acc, cur) => acc + cur.orderCount, 0);
    const totalUnfulfilled = filtered.reduce((acc, cur) => acc + (cur.orderCount - cur.fulfilledCount), 0);

    return {
      list: filtered.sort((a, b) => b.totalRevenue - a.totalRevenue),
      summary: {
        revenue: totalRevenue,
        missed: totalMissed,
        orders: totalOrders,
        unfulfilled: totalUnfulfilled
      }
    };
  }, [data, searchTerm]);

  // 3. 훅 실행이 모두 끝난 후 로딩/에러 분기 처리
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

  // 페이징 계산
  const totalPages = Math.ceil(filteredData.list.length / itemsPerPage);
  const paginatedCustomers = filteredData.list.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownloadExcel = () => {
    const rows = filteredData.list.map((c) => ({
      '거래처명': c.name,
      '거래처코드': c.id,
      '주문건수': c.orderCount,
      '납품완료': c.fulfilledCount,
      '매출액(원)': c.totalRevenue,
      '미납손실(원)': c.missedRevenue,
      '납품률(%)': c.fulfillmentRate.toFixed(1),
    }));
    exportToExcel(rows, '납품현황');
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* 헤더 및 검색바 */}
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">✅ 납품 현황 (Fulfillment)</h1>
          <p className="text-[12px] text-neutral-700 mt-1">거래처별 납품 준수율 및 매출 실시간 분석</p>
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
              placeholder="거래처명 또는 코드 검색..."
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

      {/* KPI 섹션: 검색 시 자동 합산 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiBox 
          label={searchTerm ? "검색 거래처 매출 합계" : "총 납품 매출액"} 
          value={Math.round(filteredData.summary.revenue / 1000000).toLocaleString()} 
          unit="백만원" 
          type="blue" 
          icon={CircleDollarSign}
        />
        <KpiBox 
          label="미납 기회손실" 
          value={Math.round(filteredData.summary.missed / 1000000).toLocaleString()} 
          unit="백만원" 
          type="brand" 
          icon={AlertCircle}
        />
        <KpiBox 
          label="주문 이행률" 
          value={filteredData.summary.orders > 0 ? ((1 - (filteredData.summary.unfulfilled / filteredData.summary.orders)) * 100).toFixed(1) : "0.0"} 
          unit="%" 
          type="success" 
          icon={TrendingUp}
        />
        <KpiBox 
          label="거래처 수" 
          value={filteredData.list.length.toLocaleString()} 
          unit="개사" 
          type="neutral" 
          icon={ShoppingBag}
        />
      </div>

      {/* 거래처 리스트 테이블 */}
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
                  <tr 
                    key={cust.id} 
                    onClick={() => setSelectedCustomer(cust)} 
                    className="hover:bg-blue-50/50 transition-colors cursor-pointer h-[52px]"
                  >
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
        
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-4 p-5 border-t border-neutral-200 bg-neutral-50/50">
            <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
            <span className="text-sm font-bold text-neutral-700">{currentPage} / {totalPages}</span>
            <button onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
        )}
      </div>

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
              <h3 className="font-bold text-neutral-900 mb-4 flex items-center gap-2 text-lg"><ShoppingBag size={20} className="text-blue-500"/> 주요 구매 품목</h3>
              <div className="bg-white border border-neutral-200 rounded-2xl p-2">
                {selectedCustomer.topBoughtProducts.map((p, idx) => (
                  <div key={idx} className="flex justify-between items-center p-4 border-b border-neutral-100 last:border-0">
                    <span className="text-sm font-bold text-neutral-800">{p.name}</span>
                    <span className="font-bold text-neutral-900">{Math.round(p.value/1000000).toLocaleString()}백만</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
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