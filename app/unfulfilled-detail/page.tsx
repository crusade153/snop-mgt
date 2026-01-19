'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { X, ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react';
import { IntegratedItem } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; // ✅ 추가

type FilterType = 'brand' | 'category' | 'family' | null;

export default function UnfulfilledDetailPage() {
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore(); // ✅ 단위 상태
  
  const [filter, setFilter] = useState<{ type: FilterType; value: string | null }>({ type: null, value: null });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

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

  const { filteredList, summary } = useMemo(() => {
    if (!data) return { filteredList: [], summary: { brand: [], category: [], family: [] } };

    const baseList = data.integratedArray.filter((item: IntegratedItem) => item.totalUnfulfilledQty > 0);

    const aggregate = (key: 'brand' | 'category' | 'family') => {
      const map = new Map<string, { name: string, qty: number, value: number, count: number }>();
      baseList.forEach((item: IntegratedItem) => {
        const group = item[key] || '미지정';
        if (!map.has(group)) map.set(group, { name: group, qty: 0, value: 0, count: 0 });
        const entry = map.get(group)!;
        entry.qty += item.totalUnfulfilledQty;
        entry.value += item.totalUnfulfilledValue;
        entry.count += 1;
      });
      return Array.from(map.values()).sort((a, b) => b.value - a.value);
    };

    let resultList = baseList;
    if (filter.type && filter.value) {
      resultList = baseList.filter((item: IntegratedItem) => item[filter.type!] === filter.value);
    }

    resultList.sort((a: IntegratedItem, b: IntegratedItem) => b.totalUnfulfilledValue - a.totalUnfulfilledValue);

    return {
      filteredList: resultList,
      summary: {
        brand: aggregate('brand'),
        category: aggregate('category'),
        family: aggregate('family')
      }
    };
  }, [data, filter]);

  const totalPages = Math.ceil(filteredList.length / itemsPerPage);
  const paginatedList = filteredList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
  };

  const handleFilter = (type: FilterType, value: string) => {
    if (filter.type === type && filter.value === value) {
      setFilter({ type: null, value: null });
    } else {
      setFilter({ type, value });
    }
    setCurrentPage(1); 
  };

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  return (
    <div className="space-y-6">
      <PageHeader title="📑 미납 상세 분석" desc="다차원 필터링을 통한 원인 심층 분석" />

      {filter.type && (
        <div className="flex items-center gap-2 bg-[#E3F2FD] border border-[#BBDEFB] text-[#1565C0] px-4 py-2 rounded-full w-fit animate-in fade-in slide-in-from-top-1 shadow-sm">
          <span className="font-bold text-sm">🔍 Filter:</span>
          <span className="font-bold">{filter.value}</span>
          <span className="text-[11px] bg-white px-2 py-0.5 rounded-full border border-[#BBDEFB]">{filteredList.length}건</span>
          <button onClick={() => handleFilter(null, '')} className="ml-2 hover:bg-[#BBDEFB] rounded-full p-0.5"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard title="🏷️ 브랜드별 미납" data={summary.brand} type="brand" currentFilter={filter} onFilter={handleFilter} unitMode={unitMode} />
        <SummaryCard title="📂 카테고리별 미납" data={summary.category} type="category" currentFilter={filter} onFilter={handleFilter} unitMode={unitMode} />
        <SummaryCard title="📦 제품군별 미납" data={summary.family} type="family" currentFilter={filter} onFilter={handleFilter} unitMode={unitMode} />
      </div>

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 flex justify-between items-center">
          <div className="font-bold text-neutral-700">
            <span>{filter.type ? `${filter.value} 미납 내역` : '전체 미납 SKU 리스트'}</span>
            <span className="text-[11px] font-normal text-neutral-500 ml-2">(총 {filteredList.length}개 품목)</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded">
            <HelpCircle size={12} /><span>금액 단위: 백만원 (VAT 별도)</span>
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA] sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">브랜드</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">카테고리</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품군</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">Max지연</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">
                  미납수량 ({unitMode === 'BOX' ? 'BOX' : '기준'})
                </th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-right">미납금액</th>
                <th className="px-4 py-3 border-b border-neutral-200 font-bold text-neutral-700 text-center">원인</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedList.map((item: IntegratedItem, idx: number) => {
                const maxDelay = item.unfulfilledOrders.length > 0 ? Math.max(...item.unfulfilledOrders.map(o => o.daysDelayed)) : 0;
                const causeMap: Record<string, number> = {};
                item.unfulfilledOrders.forEach(o => causeMap[o.cause] = (causeMap[o.cause] || 0) + 1);
                const majorCause = Object.keys(causeMap).sort((a,b) => causeMap[b] - causeMap[a])[0] || '기타';
                
                // 🚨 [변환]
                const dQty = formatQty(item.totalUnfulfilledQty, item.umrezBox, item.unit);

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px] group">
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                    <td className="px-4 py-3 text-neutral-500">{item.brand}</td>
                    <td className="px-4 py-3 text-neutral-500">{item.category}</td>
                    <td className="px-4 py-3 text-neutral-500">{item.family}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 group-hover:text-[#4A90E2] transition-colors">{item.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">{item.code}</div>
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${maxDelay >= 7 ? 'text-[#E53935]' : 'text-neutral-500'}`}>{maxDelay}일</td>
                    <td className="px-4 py-3 text-right text-[#E53935] font-medium">
                      {dQty.value} <span className="text-neutral-400 text-[10px] font-normal">{dQty.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-800">
                      {Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()} <span className="text-neutral-400 text-[10px] font-normal">백만</span>
                    </td>
                    <td className="px-4 py-3 text-center"><span className="px-2 py-1 bg-neutral-100 text-neutral-600 rounded text-[11px] border border-neutral-200">{majorCause}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button onClick={() => handlePageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={20} /></button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pNum = i + 1;
                if (totalPages > 5) {
                  if (currentPage <= 3) pNum = i + 1;
                  else if (currentPage >= totalPages - 2) pNum = totalPages - 4 + i;
                  else pNum = currentPage - 2 + i;
                }
                return (<button key={pNum} onClick={() => handlePageChange(pNum)} className={`w-8 h-8 rounded text-sm font-bold transition-colors ${currentPage === pNum ? 'bg-primary-blue text-white shadow-sm' : 'bg-white text-neutral-600 border border-neutral-300 hover:bg-neutral-100'}`}>{pNum}</button>);
              })}
            </div>
            <button onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={20} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

// Sub
function PageHeader({ title, desc }: any) {
  return (<div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200"><div><h1 className="text-[20px] font-bold text-neutral-900">{title}</h1><p className="text-[12px] text-neutral-700 mt-1">{desc}</p></div></div>);
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }

function SummaryCard({ title, data, type, currentFilter, onFilter, unitMode }: any) {
  return (
    <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 flex flex-col overflow-hidden max-h-[300px]">
      <div className="p-3 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 text-sm sticky top-0">{title}</div>
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-neutral-100">
            {data.map((d: any) => {
              const isActive = currentFilter.type === type && currentFilter.value === d.name;
              // 요약 카드는 집계 데이터라 단위 변환이 복잡하므로 여기서는 '건수'와 '금액' 위주로 보여주고 수량은 생략하거나 대표 단위 사용
              return (
                <tr key={d.name} onClick={() => onFilter(type, d.name)} className={`cursor-pointer transition-colors ${isActive ? 'bg-[#E3F2FD]' : 'hover:bg-[#F9F9F9]'}`}>
                  <td className="px-4 py-2.5">
                    <div className={`font-semibold ${isActive ? 'text-[#1565C0]' : 'text-neutral-800'}`}>{d.name}</div>
                    <div className="text-[11px] text-neutral-400">{d.count}건 발생</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="font-bold text-neutral-900">₩{Math.round(d.value / 1000000).toLocaleString()}백만</div>
                    <div className="text-[11px] text-[#E53935] font-medium">{d.qty.toLocaleString()} 미납</div>
                  </td>
                  <td className="px-2 py-2.5 text-neutral-400"><ChevronRight size={14} className={isActive ? 'text-[#4A90E2]' : ''} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}