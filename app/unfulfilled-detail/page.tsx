'use client'

import { useState, useMemo } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard'; // ✅ 최적화된 훅 사용
import { Calendar as CalendarIcon, X, ChevronRight } from 'lucide-react';

type FilterType = 'brand' | 'category' | 'family' | null;

export default function UnfulfilledDetailPage() {
  const { data, isLoading, dateRange, setDateRange, refetch } = useDashboardData();
  const [filter, setFilter] = useState<{ type: FilterType; value: string | null }>({ type: null, value: null });

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
      return Array.from(map.values()).sort((a, b) => b.value - a.value);
    };

    // 3. 현재 필터 적용
    let resultList = baseList;
    if (filter.type && filter.value) {
      resultList = baseList.filter(item => item[filter.type!] === filter.value);
    }

    // 금액 높은 순 정렬
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

  if (isLoading) return <LoadingSpinner />;
  if (!data) return <ErrorDisplay />;

  const handleFilter = (type: FilterType, value: string) => {
    if (filter.type === type && filter.value === value) {
      setFilter({ type: null, value: null }); // 같은거 누르면 해제
    } else {
      setFilter({ type, value });
    }
  };

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
          <button onClick={() => setFilter({ type: null, value: null })} className="ml-2 hover:bg-[#BBDEFB] rounded-full p-0.5">
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
        <div className="p-4 bg-[#FAFAFA] border-b border-neutral-200 font-bold text-neutral-700 flex justify-between items-center">
          <span>{filter.type ? `${filter.value} 미납 내역` : '전체 미납 SKU 리스트'}</span>
          <span className="text-[11px] font-normal text-neutral-500">(총 {filteredList.length}개 품목)</span>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA] sticky top-0 z-10 shadow-sm">
              <tr>
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
              {filteredList.map((item) => {
                const maxDelay = item.unfulfilledOrders.length > 0 ? Math.max(...item.unfulfilledOrders.map(o => o.daysDelayed)) : 0;
                const causeMap: Record<string, number> = {};
                item.unfulfilledOrders.forEach(o => causeMap[o.cause] = (causeMap[o.cause] || 0) + 1);
                const majorCause = Object.keys(causeMap).sort((a,b) => causeMap[b] - causeMap[a])[0] || '기타';

                return (
                  <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px] group">
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
                      {item.totalUnfulfilledValue.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-1 bg-neutral-100 text-neutral-600 rounded text-[11px] border border-neutral-200">
                        {majorCause}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filteredList.length === 0 && (
                <tr><td colSpan={8} className="p-10 text-center text-neutral-400">해당 조건의 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
                    <div className="font-bold text-neutral-900">₩{Math.round(d.value / 10000).toLocaleString()}만</div>
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