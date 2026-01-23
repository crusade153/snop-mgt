'use client'

import { useState } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { ChevronLeft, ChevronRight, HelpCircle, Users, Clock } from 'lucide-react';
import { IntegratedItem } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store';

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

export default function DeliveryPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore(); 
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [selectedProduct, setSelectedProduct] = useState<IntegratedItem | null>(null);

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  // Helper
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

  const unfulfilledList = data.integratedArray
    .filter((item: IntegratedItem) => item.totalUnfulfilledQty > 0)
    .sort((a: IntegratedItem, b: IntegratedItem) => b.totalUnfulfilledValue - a.totalUnfulfilledValue);
  
  const totalUnfulfilledCount = unfulfilledList.reduce((acc: number, cur: IntegratedItem) => acc + cur.unfulfilledOrders.length, 0);
  const totalPages = Math.ceil(unfulfilledList.length / itemsPerPage);
  const paginatedList = unfulfilledList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="🚨 미납 리스트 (Delivery Issue)" desc="고객 약속 미이행 건 및 원인 집중 관리" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded shadow border border-[#E53935] bg-[#FFEBEE]">
          <div className="text-[12px] font-bold text-[#E53935] mb-1">총 미납 주문 건수</div>
          <div className="text-[24px] font-bold text-[#C62828]">{totalUnfulfilledCount.toLocaleString()}<span className="text-[12px] font-normal ml-1 opacity-80">건</span></div>
        </div>
        <div className="p-5 rounded shadow border border-[#E53935] bg-[#FFEBEE]">
          <div className="text-[12px] font-bold text-[#E53935] mb-1">총 미납 기회손실</div>
          <div className="text-[24px] font-bold text-[#C62828]">{Math.round(data.kpis.totalUnfulfilledValue / 1000000).toLocaleString()}<span className="text-[12px] font-normal ml-1 opacity-80">백만원</span></div>
        </div>
      </div>

      <div className="bg-white rounded shadow border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 flex justify-between items-center">
          <span className="font-bold text-neutral-700">📋 제품별 미납 현황 (손실액 순)</span>
          <div className="flex items-center gap-1 text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded">
            <HelpCircle size={12} /> <span>금액 단위: 백만원</span>
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse table-fixed">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 w-[35%]">제품명</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">미납수량 ({unitMode === 'BOX' ? 'BOX' : '기준'})</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-right">미납금액</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center">주요 원인</th>
                <th className="px-4 py-3 border-b font-bold text-neutral-700 text-center">Max 지연</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedList.map((item: IntegratedItem, idx: number) => {
                  const causes = item.unfulfilledOrders.map(o => o.cause);
                  const majorCause = causes.sort((a,b) => causes.filter(v => v===a).length - causes.filter(v => v===b).length).pop() || '기타';
                  const maxDelay = Math.max(...item.unfulfilledOrders.map(o => o.daysDelayed));
                  const rowNo = (currentPage - 1) * itemsPerPage + idx + 1;
                  const displayQty = formatQty(item.totalUnfulfilledQty, item.umrezBox, item.unit);

                  return (
                    <tr key={item.code} onClick={() => setSelectedProduct(item)} className="hover:bg-red-50 transition-colors cursor-pointer h-[48px]">
                      <td className="px-4 py-3 text-center text-neutral-400 text-xs">{rowNo}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-900 line-clamp-2 leading-tight" title={item.name}>{item.name}</div>
                        <div className="text-[11px] text-neutral-500 font-mono mt-0.5">{item.code}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[#E53935]">
                        {displayQty.value} <span className="text-[10px] font-normal text-neutral-400">{displayQty.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-700 font-medium">{Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()}백만원</td>
                      <td className="px-4 py-3 text-center"><CauseBadge cause={majorCause} /></td>
                      <td className="px-4 py-3 text-center"><span className={`font-bold ${maxDelay >= 7 ? 'text-[#E53935]' : 'text-neutral-500'}`}>{maxDelay}일</span></td>
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
        isOpen={!!selectedProduct} 
        onClose={() => setSelectedProduct(null)}
        title="미납 상세 정보 (Deep Dive)"
      >
        {selectedProduct && (
          <div className="space-y-8">
            {/* 상단 요약 카드 */}
            <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="inline-block px-2 py-1 rounded bg-neutral-100 text-neutral-500 text-xs font-mono mb-2">{selectedProduct.code}</span>
                  <h3 className="text-lg font-bold text-neutral-900 leading-snug">{selectedProduct.name}</h3>
                </div>
                <div className="text-right">
                  <div className="text-xs text-neutral-500 mb-1">총 미납 기회액</div>
                  <div className="text-xl font-bold text-[#E53935]">{Math.round(selectedProduct.totalUnfulfilledValue / 1000000).toLocaleString()}백만원</div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3 border-t border-neutral-100 pt-4">
                <div>
                  <div className="text-xs text-neutral-500 mb-1">총 미납 수량</div>
                  <div className="font-bold text-neutral-800">
                    {formatQty(selectedProduct.totalUnfulfilledQty, selectedProduct.umrezBox, selectedProduct.unit).value}
                    <span className="text-xs font-normal text-neutral-400 ml-1">{formatQty(selectedProduct.totalUnfulfilledQty, selectedProduct.umrezBox, selectedProduct.unit).unit}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">현재 보유 재고</div>
                  <div className={`font-bold ${selectedProduct.inventory.totalStock === 0 ? 'text-red-500' : 'text-neutral-800'}`}>
                    {formatQty(selectedProduct.inventory.totalStock, selectedProduct.umrezBox, selectedProduct.unit).value}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">판매 속도 (ADS)</div>
                  {/* ✅ [수정] 수량 ADS 값 연동 및 단위 변환 적용 */}
                  <div className="font-bold text-blue-600">
                    {formatQty(selectedProduct.inventory.ads, selectedProduct.umrezBox, selectedProduct.unit).value}
                    <span className="text-xs font-normal text-neutral-400 ml-1">
                      {formatQty(selectedProduct.inventory.ads, selectedProduct.umrezBox, selectedProduct.unit).unit}/일
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
              <Clock className="text-blue-600 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-blue-900 text-sm mb-1">S&OP 인사이트</h4>
                <p className="text-xs text-blue-700 leading-relaxed">
                  현재 일평균 <strong>{formatQty(selectedProduct.inventory.ads, selectedProduct.umrezBox, selectedProduct.unit).value}{formatQty(selectedProduct.inventory.ads, selectedProduct.umrezBox, selectedProduct.unit).unit}</strong>가 팔리고 있습니다.<br/>
                  {selectedProduct.inventory.totalStock === 0 
                    ? "재고가 고갈되어 즉시 생산 투입이 필요합니다. 생산팀에 긴급 오더를 확인하세요." 
                    : `현재 재고로 약 ${(selectedProduct.inventory.totalStock / (selectedProduct.inventory.ads || 1)).toFixed(1)}일 운영할 수 있습니다.`}
                </p>
              </div>
            </div>

            {/* 거래처별 대기 현황 */}
            <div>
              <h3 className="font-bold text-neutral-900 mb-3 flex items-center gap-2">
                <Users size={18} className="text-neutral-500"/> 기다리고 있는 거래처 ({selectedProduct.unfulfilledOrders.length}곳)
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
                          <div className="flex gap-2">
                            <span>요청일: <span className="font-mono text-neutral-700">{order.reqDate}</span></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-red-500 flex items-center gap-1">
                              <Clock size={12}/> +{order.daysDelayed}일 지연
                            </span>
                            <CauseBadge cause={order.cause} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
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
function CauseBadge({ cause }: { cause: string }) {
  const styles: Record<string, string> = { 
    '재고 부족': 'bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]', 
    '당일 재고 부족': 'bg-[#FFF3E0] text-[#EF6C00] border border-[#FFE0B2]', 
  };
  return (<span className={`px-2 py-1 rounded text-[11px] font-bold border ${styles[cause] || 'bg-[#F5F5F5] text-[#616161] border-[#E0E0E0]'}`}>{cause}</span>);
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div><span className="text-neutral-500 text-sm">데이터 분석 중...</span></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }