'use client'

import { useState } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { ChevronLeft, ChevronRight, ShoppingBag, AlertCircle, Clock } from 'lucide-react';
import { CustomerStat } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; // ✅ Store 추가

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

export default function FulfillmentPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore(); // ✅ 단위 상태 구독
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerStat | null>(null);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  // Helper: 단위 변환 함수
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

  const { summary, byCustomer } = data.fulfillment;
  
  const sortedCustomers = [...byCustomer].sort((a: CustomerStat, b: CustomerStat) => b.totalRevenue - a.totalRevenue);
  
  const totalPages = Math.ceil(sortedCustomers.length / itemsPerPage);
  const paginatedCustomers = sortedCustomers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="✅ 납품 현황 (Fulfillment)" desc="거래처별 납품 준수율 및 매출 효율성 분석" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiBox label="총 주문 건수" value={summary.totalOrders.toLocaleString()} unit="건" type="blue" />
        <KpiBox label="완전 납품" value={summary.fulfilledOrders.toLocaleString()} unit="건" type="success" />
        <KpiBox label="미납 발생" value={summary.unfulfilledCount.toLocaleString()} unit="건" type="brand" />
        <KpiBox label="거래처 수" value={summary.totalCustomers.toLocaleString()} unit="개사" type="neutral" />
      </div>

      <div className="bg-white rounded shadow border border-neutral-200 overflow-hidden">
        <div className="p-5 border-b border-neutral-200 bg-white flex justify-between items-center">
          <h2 className="text-[16px] font-semibold text-neutral-900">🏢 거래처별 납품 성과 (총매출액 순)</h2>
          <div className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded">클릭하여 상세 내역 조회</div>
        </div>
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b text-center w-16 font-bold text-neutral-700">No</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700">거래처명</th>
                <th className="px-4 py-3 border-b text-right font-bold text-neutral-700">총 주문</th>
                <th className="px-4 py-3 border-b text-right font-bold text-neutral-700">총 매출액</th>
                <th className="px-4 py-3 border-b text-right font-bold text-neutral-700">미납 기회손실액</th>
                <th className="px-4 py-3 border-b text-center font-bold text-neutral-700">준수율</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedCustomers.map((cust: CustomerStat, idx: number) => {
                const rowNo = (currentPage - 1) * itemsPerPage + idx + 1;
                return (
                  <tr 
                    key={cust.id} 
                    onClick={() => setSelectedCustomer(cust)} 
                    className="hover:bg-blue-50 transition-colors cursor-pointer h-[48px]"
                  >
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">{rowNo}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{cust.name}</div>
                      <div className="text-[11px] text-neutral-500 font-mono">{cust.id}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-700">{cust.orderCount.toLocaleString()}건</td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-900">{Math.round(cust.totalRevenue / 1000000).toLocaleString()}백만원</td>
                    <td className={`px-4 py-3 text-right font-bold ${cust.missedRevenue > 0 ? 'text-primary-brand' : 'text-neutral-300'}`}>
                      {cust.missedRevenue > 0 ? `${Math.round(cust.missedRevenue / 1000000).toLocaleString()}백만원` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${cust.fulfillmentRate >= 95 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
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
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={20} /></button>
            <span className="text-sm font-bold text-neutral-600">{currentPage} / {totalPages}</span>
            <button onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>

      <WideRightSheet 
        isOpen={!!selectedCustomer} 
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.name || '거래처 상세'}
      >
        {selectedCustomer && (
          <div className="space-y-8">
            {/* 요약 카드 */}
            <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="inline-block px-2 py-1 rounded bg-neutral-100 text-neutral-500 text-xs font-mono mb-2">{selectedCustomer.id}</span>
                  <h3 className="text-lg font-bold text-neutral-900 leading-snug">{selectedCustomer.name}</h3>
                </div>
                <div className="text-right">
                  <div className="text-xs text-neutral-500 mb-1">총 미납 기회손실액</div>
                  <div className="text-xl font-bold text-[#E53935]">{Math.round(selectedCustomer.missedRevenue / 1000000).toLocaleString()}백만원</div>
                </div>
              </div>
            </div>

            {/* Top 10 구매 품목 (단위 변환 적용) */}
            <div>
              <h3 className="font-bold text-neutral-900 mb-4 flex items-center gap-2 text-lg">
                <ShoppingBag size={20} className="text-blue-500"/> 주요 구매 품목 (Top 10)
              </h3>
              <div className="bg-white border border-neutral-200 rounded-xl p-2 shadow-sm">
                {selectedCustomer.topBoughtProducts.map((p, idx) => {
                  // 🚨 [변환]
                  const displayQty = formatQty(p.qty, p.umrezBox, p.unit);
                  
                  return (
                    <div key={idx} className="flex justify-between items-center text-sm border-b border-neutral-100 last:border-0 p-3 hover:bg-neutral-50 transition-colors">
                      <div className="flex items-center gap-3 flex-1">
                        <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">{idx+1}</span>
                        <span className="text-neutral-800 font-medium break-words leading-snug pr-4">{p.name}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-neutral-900 text-base">{Math.round(p.value/1000000).toLocaleString()}백만</div>
                        {/* 변환된 수량 표시 */}
                        <div className="text-xs text-neutral-400">
                          {displayQty.value} {displayQty.unit}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 미납 내역 리스트 (단위 변환 적용) */}
            <div>
              <h3 className="font-bold text-neutral-900 mb-4 flex items-center gap-2 text-lg">
                <AlertCircle size={20} className="text-red-500"/> 미납 발생 내역 ({selectedCustomer.unfulfilledDetails.length}건)
              </h3>
              
              {selectedCustomer.unfulfilledDetails.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {selectedCustomer.unfulfilledDetails.map((order, idx) => {
                    // 미납 내역의 경우 제품 코드로 umrezBox를 찾아야 하지만, 
                    // UnfulfilledOrder 구조상 단순화를 위해 1:1 매칭이 어려울 수 있음.
                    // 정확성을 위해 Dashboard 데이터에서 제품정보를 찾아오는 로직을 추가합니다.
                    const productInfo = data.integratedArray.find(i => i.name === order.productName);
                    const umrezBox = productInfo?.umrezBox || 1;
                    const unit = productInfo?.unit || 'EA';
                    
                    const displayQty = formatQty(order.qty, umrezBox, unit);

                    return (
                      <div key={idx} className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm hover:border-red-300 transition-all">
                        <div className="font-bold text-neutral-900 mb-2 break-words leading-tight text-base">
                          {order.productName}
                        </div>
                        
                        <div className="flex justify-between items-end border-t border-neutral-100 pt-3">
                          <div className="text-neutral-600 text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <Clock size={12}/> 요청일: {order.reqDate}
                            </div>
                            <div className="flex items-center gap-2 text-red-600 font-bold">
                              <Clock size={12}/> +{order.daysDelayed}일 지연중
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-red-600 text-lg">
                              {displayQty.value} <span className="text-sm font-normal">{displayQty.unit}</span>
                            </div>
                            <CauseBadge cause={order.cause} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-center bg-green-50 text-green-700 rounded-xl border border-green-100">
                  <div className="text-4xl mb-2">🎉</div>
                  <div className="font-bold">현재 미납 건이 없습니다.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </WideRightSheet>
    </div>
  );
}

function PageHeader({ title, desc }: any) {
  return (<div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200"><div><h1 className="text-[20px] font-bold text-neutral-900">{title}</h1><p className="text-[12px] text-neutral-700 mt-1">{desc}</p></div></div>);
}
function KpiBox({ label, value, unit, type }: any) {
  const styles: any = { brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]' }, blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]' }, success: { bg: 'bg-[#E8F5E9]', text: 'text-[#2E7D32]', label: 'text-[#42A5F5]' }, warning: { bg: 'bg-[#FFF3E0]', text: 'text-[#EF6C00]', label: 'text-[#FFA726]' }, neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]', label: 'text-[#757575]' }, };
  const s = styles[type] || styles.neutral;
  return (<div className={`p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 ${s.bg}`}><div className={`text-[12px] font-medium mb-1 ${s.label}`}>{label}</div><div className={`text-[24px] font-bold ${s.text}`}>{value}<span className="text-[12px] font-normal ml-1 opacity-70">{unit}</span></div></div>);
}
function CauseBadge({ cause }: { cause: string }) {
  const styles: Record<string, string> = { 
    '재고 부족': 'bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]', 
    '당일 재고 부족': 'bg-[#FFF3E0] text-[#EF6C00] border border-[#FFE0B2]', 
  };
  return (<span className={`px-2 py-1 rounded text-[11px] font-bold border mt-1 inline-block ${styles[cause] || 'bg-[#F5F5F5] text-[#616161] border-[#E0E0E0]'}`}>{cause}</span>);
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div><span className="text-neutral-500 text-sm">데이터 분석 중...</span></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }