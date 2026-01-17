'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Calendar as CalendarIcon, X, ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react';

type FilterType = 'brand' | 'category' | 'family' | null;

export default function UnfulfilledDetailPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();
  
  // 1. 필터 및 페이지네이션 상태
  const [filter, setFilter] = useState<{ type: FilterType; value: string | null }>({ type: null, value: null });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // 🔄 데이터 실시간 가공 (Memoization)
  const { filteredList, summary } = useMemo(() => {
    if (!data) return { filteredList: [], summary: { brand: [], category: [], family: [] } };

    // 1. 미납이 있는 품목만 추출
    const baseList = data.integratedArray.filter(item => item.totalUnfulfilledQty > 0);

    // 2. 요약 통계 생성 (필터 적용 전 전체 기준)
    const aggregate = (key: 'brand' | 'category' | 'family') => {
      const map = new Map<string, { name: string, qty: number, value: number, count: number }>();
      baseList.forEach(item => {
        const group = item[key] || '미지정';
        if (!map.has(group)) map.set(group, { name: group, qty: 0, value: 0, count: 0 });
        const entry = map.get(group)!;
        entry.qty += item.totalUnfulfilledQty;
        entry.value += item.totalUnfulfilledValue;
        entry.count += 1;
      });
      // 금액 높은 순 정렬
      return Array.from(map.values()).sort((a, b) => b.value - a.value);
    };

    // 3. 현재 필터 적용
    let resultList = baseList;
    if (filter.type && filter.value) {
      resultList = baseList.filter(item => item[filter.type!] === filter.value);
    }

    // 4. 금액 높은 순 정렬 (전체 리스트)
    resultList.sort((a, b) => b.totalUnfulfilledValue - a.totalUnfulfilledValue);

    return {
      filteredList: resultList,
      summary: {
        brand: aggregate('brand'),
        category: aggregate('category'),
        family: aggregate('family')
      }
    };
  }, [data, filter]);

  // 페이지네이션 계산
  const totalPages = Math.ceil(filteredList.length / itemsPerPage);
  const paginatedList = filteredList.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 페이지 변경 핸들러
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' }); // 맨 위로 스크롤
  };

  // 필터 핸들러 (필터 변경 시 1페이지로 리셋)
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
      {/* Header & Date Picker */}
      <PageHeader 
        title="📑 미납 상세 분석" 
        desc="다차원 필터링을 통한 원인 심층 분석"
        dateRange={dateRange}
        setDateRange={setDateRange}
        onRefresh={refetch}
      />

      {/* 활성 필터 표시 */}
      {filter.type && (
        <div className="flex items-center gap-2 bg-[#E3F2FD] border border-[#BBDEFB] text-[#1565C0] px-4 py-2 rounded-full w-fit animate-in fade-in slide-in-from-top-1 shadow-sm">
          <span className="font-bold text-sm">🔍 Filter:</span>
          <span className="font-bold">{filter.value}</span>
          <span className="text-[11px] bg-white px-2 py-0.5 rounded-full border border-[#BBDEFB]">{filteredList.length}건</span>
          <button onClick={() => handleFilter(null, '')} className="ml-2 hover:bg-[#BBDEFB] rounded-full p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 요약 카드 (인터랙티브) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard title="🏷️ 브랜드별 미납" data={summary.brand} type="brand" currentFilter={filter} onFilter={handleFilter} />
        <SummaryCard title="📂 카테고리별 미납" data={summary.category} type="category" currentFilter={filter} onFilter={handleFilter} />
        <SummaryCard title="📦 제품군별 미납" data={summary.family} type="family" currentFilter={filter} onFilter={handleFilter} />
      </div>

      {/* 상세 테이블 */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden">
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 flex justify-between items-center">
          <div className="font-bold text-neutral-700">
            <span>{filter.type ? `${filter.value} 미납 내역` : '전체 미납 SKU 리스트'}</span>
            <span className="text-[11px] font-normal text-neutral-500 ml-2">(총 {filteredList.length}개 품목)</span>
          </div>
          {/* 🚨 [수정] 금액 단위 툴팁 */}
          <div className="flex items-center gap-1 text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded">
            <HelpCircle size={12} />
            <span>금액 단위: 백만원 (VAT 별도)</span>
          </div>
        </div>
        
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA] sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 w-12 text-center">No</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">브랜드</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">카테고리</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품군</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">Max지연</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납수량</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납금액</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">원인</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {paginatedList.map((item, idx) => {
                const maxDelay = item.unfulfilledOrders.length > 0 ? Math.max(...item.unfulfilledOrders.map(o => o.daysDelayed)) : 0;
                const causeMap: Record<string, number> = {};
                item.unfulfilledOrders.forEach(o => causeMap[o.cause] = (causeMap[o.cause] || 0) + 1);
                const majorCause = Object.keys(causeMap).sort((a,b) => causeMap[b] - causeMap[a])[0] || '기타';
                const rowNo = (currentPage - 1) * itemsPerPage + idx + 1;

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px] group">
                    <td className="px-4 py-3 text-center text-neutral-400 text-xs">{rowNo}</td>
                    <td className="px-4 py-3 text-neutral-500">{item.brand}</td>
                    <td className="px-4 py-3 text-neutral-500">{item.category}</td>
                    <td className="px-4 py-3 text-neutral-500">{item.family}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 group-hover:text-[#4A90E2] transition-colors">{item.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">{item.code}</div>
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${maxDelay >= 7 ? 'text-[#E53935]' : 'text-neutral-500'}`}>
                      {maxDelay}일
                    </td>
                    <td className="px-4 py-3 text-right text-[#E53935] font-medium">
                      {item.totalUnfulfilledQty.toLocaleString()} <span className="text-neutral-400 text-[10px] font-normal">{item.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-800">
                      {/* 🚨 [수정] 백만원 단위 표기 */}
                      {Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()} <span className="text-neutral-400 text-[10px] font-normal">백만</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-1 bg-neutral-100 text-neutral-600 rounded text-[11px] border border-neutral-200">
                        {majorCause}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {paginatedList.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-neutral-400">해당 조건의 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 🚨 [추가] 페이지네이션 컨트롤 */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 p-4 border-t border-neutral-200 bg-[#FAFAFA]">
            <button 
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed text-neutral-600"
            >
              <ChevronLeft size={20} />
            </button>
            
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pNum = i + 1;
                if (totalPages > 5) {
                  if (currentPage <= 3) pNum = i + 1;
                  else if (currentPage >= totalPages - 2) pNum = totalPages - 4 + i;
                  else pNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pNum}
                    onClick={() => handlePageChange(pNum)}
                    className={`w-8 h-8 rounded text-sm font-bold transition-colors
                      ${currentPage === pNum 
                        ? 'bg-primary-blue text-white shadow-sm' 
                        : 'bg-white text-neutral-600 border border-neutral-300 hover:bg-neutral-100'}`}
                  >
                    {pNum}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed text-neutral-600"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub Components ---

function PageHeader({ title, desc, dateRange, setDateRange, onRefresh }: any) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
      <div><h1 className="text-[20px] font-bold text-neutral-900">{title}</h1><p className="text-[12px] text-neutral-700 mt-1">{desc}</p></div>
      <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-neutral-200 shadow-sm"><CalendarIcon size={14} className="text-neutral-500" /><input type="date" value={dateRange.startDate} onChange={e => setDateRange((p:any) => ({ ...p, startDate: e.target.value }))} className="text-xs text-neutral-700 outline-none font-medium" /><span className="text-neutral-400 text-xs">~</span><input type="date" value={dateRange.endDate} onChange={e => setDateRange((p:any) => ({ ...p, endDate: e.target.value }))} className="text-xs text-neutral-700 outline-none font-medium" /><div className="w-[1px] h-4 bg-neutral-200 mx-1"></div><button onClick={() => onRefresh()} className="text-xs font-bold text-[#4A90E2] hover:text-blue-700 transition-colors">조회</button></div>
    </div>
  );
}
function LoadingSpinner() { return <div className="flex items-center justify-center h-[calc(100vh-100px)]"><div className="flex flex-col items-center gap-3"><div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div><span className="text-neutral-500 text-sm">상세 분석 중...</span></div></div>; }
function ErrorDisplay() { return <div className="p-10 text-center text-[#E53935]">데이터 로드 실패</div>; }

function SummaryCard({ title, data, type, currentFilter, onFilter }: any) {
  return (
    <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 flex flex-col overflow-hidden max-h-[300px]">
      <div className="p-3 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 text-sm sticky top-0">
        {title}
      </div>
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-neutral-100">
            {data.map((d: any) => {
              const isActive = currentFilter.type === type && currentFilter.value === d.name;
              return (
                <tr 
                  key={d.name} 
                  onClick={() => onFilter(type, d.name)}
                  className={`cursor-pointer transition-colors ${isActive ? 'bg-[#E3F2FD]' : 'hover:bg-[#F9F9F9]'}`}
                >
                  <td className="px-4 py-2.5">
                    <div className={`font-semibold ${isActive ? 'text-[#1565C0]' : 'text-neutral-800'}`}>{d.name}</div>
                    <div className="text-[11px] text-neutral-400">{d.count}건 발생</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {/* 🚨 [수정] 백만원 단위 표기 */}
                    <div className="font-bold text-neutral-900">₩{Math.round(d.value / 1000000).toLocaleString()}백만</div>
                    <div className="text-[11px] text-[#E53935] font-medium">{d.qty.toLocaleString()} 미납</div>
                  </td>
                  <td className="px-2 py-2.5 text-neutral-400">
                    <ChevronRight size={14} className={isActive ? 'text-[#4A90E2]' : ''} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// app/unfulfilled-detail/page.tsx 파일 하단 CauseBadge 함수 교체
function CauseBadge({ cause }: { cause: string }) {
  const styles: Record<string, string> = {
    '재고 부족': 'bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]', 
    '당일 재고 부족': 'bg-[#FFF3E0] text-[#EF6C00] border border-[#FFE0B2]', 
  };
  return (
    <span className={`px-2 py-1 rounded text-[11px] font-bold border ${styles[cause] || 'bg-[#F5F5F5] text-[#616161] border-[#E0E0E0]'}`}>
      {cause}
    </span>
  );
}