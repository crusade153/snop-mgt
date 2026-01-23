'use client'

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query'; // ✅ React Query 도입
import { getDailyWatchReport, DailyAlertItem } from '@/actions/daily-actions';
import { useDateStore } from '@/store/date-store';
import { useUiStore } from '@/store/ui-store';
import { 
  AlertTriangle, TrendingUp, CalendarClock, Truck, CheckCircle, 
  RefreshCw, Clock, Info, CheckSquare, BarChart2, Package, 
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp
} from 'lucide-react';

type TabType = 'ALL' | 'SPIKE' | 'SHORTAGE' | 'FRESHNESS' | 'MISS';

export default function DailyWatchPage() {
  const { endDate } = useDateStore(); 
  const { unitMode } = useUiStore(); // 단위 설정 (BOX / EA)
  
  // ✅ [최적화] React Query로 데이터 페칭 로직 교체
  const { data: report, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['daily-watch-report', endDate],
    queryFn: () => getDailyWatchReport(endDate),
    staleTime: Infinity, 
    gcTime: 1000 * 60 * 60 * 24, // 24시간 동안 캐시 유지
    refetchOnWindowFocus: false, // 윈도우 포커스 시 재요청 방지
  });

  // 데이터 바인딩
  const items = report?.data || [];
  const summary = report?.summary || { scannedCount: 0, topOrders: [], lowestBalance: [] };
  const runTime = report?.runTime || '';

  // UI 상태
  const [activeTab, setActiveTab] = useState<TabType>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  
  const ITEMS_PER_PAGE = 15;

  // ✅ [Helper] 단위 변환 함수
  const formatQty = (qty: number, umrez: number, unit: string) => {
    if (unitMode === 'BOX') {
      const boxes = qty / (umrez > 0 ? umrez : 1);
      return `${boxes.toLocaleString(undefined, { maximumFractionDigits: 1 })} Box`;
    }
    return `${Math.round(qty).toLocaleString()} ${unit}`;
  };

  // ✅ [New] 메시지 동적 렌더링 함수 (단위 변환 적용)
  const renderMessage = (item: DailyAlertItem) => {
    // 1. 결품 예상 (Shortage): 수요 vs 공급 숫자 변환
    if (item.type === 'SHORTAGE' && item.val1 !== undefined && item.val2 !== undefined) {
       const dDemand = formatQty(item.val1, item.umrez, item.unit);
       const dSupply = formatQty(item.val2, item.umrez, item.unit);
       
       return (
         <span>
           향후 7일간 확정된 납품 요청(<strong>{dDemand}</strong>) 대비 
           재고(<strong>{dSupply}</strong>) 부족
         </span>
       );
    }
    
    // 2. 소진 불가 (Burn-down): 판매속도(ADS) 변환
    if (item.type === 'FRESHNESS' && item.id.startsWith('burn-') && item.val1 !== undefined) {
        const dAds = formatQty(item.val1, item.umrez, item.unit);
        const days = item.val2; // 잔여일
        return (
            <span>
                판매 속도(<strong>{dAds}/일</strong>) 대비 유통기한 부족 (잔여 {days}일)
            </span>
        );
    }

    // 그 외는 서버에서 온 메시지 그대로 표시
    return item.message;
  };

  // 필터링 및 페이징 로직
  const filteredItems = useMemo(() => {
    if (activeTab === 'ALL') return items;
    return items.filter(item => item.type === activeTab);
  }, [items, activeTab]);

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  // 탭 버튼 컴포넌트
  const TabButton = ({ label, type, count }: { label: string, type: TabType, count: number }) => {
    let activeClass = 'bg-neutral-800 text-white';
    if (type === 'SPIKE') activeClass = 'bg-orange-600 text-white';
    if (type === 'SHORTAGE') activeClass = 'bg-red-600 text-white';
    if (type === 'FRESHNESS') activeClass = 'bg-red-700 text-white';
    if (type === 'MISS') activeClass = 'bg-yellow-600 text-white';

    return (
      <button
        onClick={() => handleTabChange(type)}
        className={`px-3 py-1.5 text-xs font-bold rounded transition-all flex items-center gap-1.5 border ${
          activeTab === type 
            ? activeClass + ' border-transparent shadow-sm' 
            : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
        }`}
      >
        {label}
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeTab === type ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
          {count}
        </span>
      </button>
    );
  };

  // 테이블 행 렌더링
  const renderRow = (item: DailyAlertItem, idx: number) => {
    let typeBadgeClass = '';
    let typeLabel = '';
    let typeIcon = null;

    switch (item.type) {
      case 'SPIKE':
        typeBadgeClass = 'bg-orange-50 text-orange-700 border-orange-100';
        typeLabel = '수요 급변';
        typeIcon = <TrendingUp size={12}/>;
        break;
      case 'SHORTAGE':
        typeBadgeClass = 'bg-red-50 text-red-700 border-red-100';
        typeLabel = '결품 예상';
        typeIcon = <AlertTriangle size={12}/>;
        break;
      case 'FRESHNESS':
        typeBadgeClass = 'bg-red-50 text-red-800 border-red-100';
        typeLabel = '소진 불가';
        typeIcon = <CalendarClock size={12}/>;
        break;
      case 'MISS':
        typeBadgeClass = 'bg-yellow-50 text-yellow-700 border-yellow-100';
        typeLabel = '미납 발생';
        typeIcon = <Truck size={12}/>;
        break;
    }

    return (
      <tr key={item.id} className="hover:bg-neutral-50 transition-colors border-b border-neutral-100 last:border-0">
        <td className="px-4 py-3 text-center text-xs text-neutral-400 font-mono">
          {(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border ${typeBadgeClass}`}>
            {typeIcon} {typeLabel}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="font-bold text-neutral-900 text-sm">{item.productName}</div>
          <div className="text-[11px] text-neutral-400 font-mono">{item.productCode}</div>
        </td>
        {/* ✅ [수정] renderMessage 함수를 사용하여 메시지 내 숫자도 단위 변환 적용 */}
        <td className="px-4 py-3 text-sm text-neutral-700">
          {renderMessage(item)}
        </td>
        <td className="px-4 py-3 text-right font-bold text-neutral-900 text-sm whitespace-nowrap">
          {formatQty(item.qty, item.umrez, item.unit)}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-100 max-w-[280px] truncate justify-end">
            <CheckCircle size={12} />
            <span className="truncate">{item.action}</span>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto py-6 animate-in fade-in slide-in-from-bottom-4">
      {/* 1. 헤더 섹션 */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-4 pb-4 border-b border-neutral-200">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#E53935]"></span>
            </span>
            일일 관리 대시보드 (Daily Watch)
          </h1>
          <span className="text-xs text-neutral-500 bg-neutral-100 px-2 py-1 rounded">
            기준일: {endDate}
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsGuideOpen(!isGuideOpen)}
            className="flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            <Info size={14}/> 감시 기준 보기 {isGuideOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          </button>

          <div className="w-[1px] h-3 bg-neutral-300"></div>

          <span className="text-[11px] text-neutral-400 flex items-center gap-1">
            <Clock size={12}/> {runTime ? `갱신: ${runTime}` : '...'}
          </span>
          <button 
            onClick={() => refetch()} 
            disabled={isLoading || isRefetching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white rounded text-xs font-bold hover:bg-neutral-800 transition-colors disabled:opacity-50 ml-2"
          >
            <RefreshCw size={12} className={isLoading || isRefetching ? 'animate-spin' : ''}/>
            새로고침
          </button>
        </div>
      </div>

      {/* 2. 가이드 섹션 */}
      {isGuideOpen && (
        <div className="mb-6 bg-neutral-50 rounded-lg border border-neutral-200 p-4 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <GuideItem icon={<TrendingUp size={16} className="text-orange-600"/>} title="수요 급변" desc="전주 평균 대비 2.0배 이상 주문 폭증 감시" />
            <GuideItem icon={<AlertTriangle size={16} className="text-red-600"/>} title="7일 내 결품" desc="재고+생산 < 7일 주문량 일 때 경고" />
            <GuideItem icon={<CalendarClock size={16} className="text-red-600"/>} title="소진 불가" desc="판매속도 대비 유통기한 부족 시 알림" />
            <GuideItem icon={<Truck size={16} className="text-yellow-600"/>} title="미납 발생" desc="어제 미출고된 건이 있는지 확인" />
          </div>
        </div>
      )}

      {/* 3. 필터 탭 & 요약 정보 */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4 mb-4">
        <div className="flex flex-wrap gap-2">
          <TabButton label="전체 이슈" type="ALL" count={items.length} />
          <TabButton label="수요 급변" type="SPIKE" count={items.filter(i=>i.type==='SPIKE').length} />
          <TabButton label="결품 예상" type="SHORTAGE" count={items.filter(i=>i.type==='SHORTAGE').length} />
          <TabButton label="소진 불가" type="FRESHNESS" count={items.filter(i=>i.type==='FRESHNESS').length} />
          <TabButton label="미납 발생" type="MISS" count={items.filter(i=>i.type==='MISS').length} />
        </div>
        <div className="text-xs text-neutral-500 font-medium">
          시스템이 총 <span className="font-bold text-neutral-900">{summary.scannedCount.toLocaleString()}</span>개 품목을 검사했습니다.
        </div>
      </div>

      {/* 4. 메인 테이블 */}
      <div className="bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-[400px] gap-3">
            <div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin"></div>
            <p className="text-sm text-neutral-500">데이터 정밀 분석 중...</p>
          </div>
        ) : filteredItems.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 font-bold text-neutral-600 text-xs text-center w-12">No</th>
                    <th className="px-4 py-3 font-bold text-neutral-600 text-xs w-32">이슈 유형</th>
                    <th className="px-4 py-3 font-bold text-neutral-600 text-xs w-64">제품명</th>
                    <th className="px-4 py-3 font-bold text-neutral-600 text-xs">상세 원인 (Why)</th>
                    <th className="px-4 py-3 font-bold text-neutral-600 text-xs text-right w-32">핵심 수치</th>
                    <th className="px-4 py-3 font-bold text-neutral-600 text-xs text-right w-64">권장 조치 (Action)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {paginatedItems.map((item, idx) => renderRow(item, idx))}
                </tbody>
              </table>
            </div>
            
            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 py-4 border-t border-neutral-200 bg-neutral-50/50">
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={16}/>
                </button>
                <span className="text-xs font-bold text-neutral-600">
                  {currentPage} / {totalPages}
                </span>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={16}/>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-[400px] gap-4">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center">
              <CheckCircle size={32} />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-neutral-900">발견된 특이사항이 없습니다</h3>
              <p className="text-sm text-neutral-500 mt-1">모든 제품이 정상 범위 내에서 운영되고 있습니다.</p>
            </div>
          </div>
        )}
      </div>

      {/* 5. Daily Briefing */}
      <div className="mt-8 pt-6 border-t border-neutral-200">
        <h3 className="text-base font-bold text-neutral-800 mb-4 flex items-center gap-2">
          <CheckSquare size={16} /> Daily Briefing (주요 현황 요약)
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 어제 베스트 셀러 */}
          <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-sm">
            <h4 className="text-xs font-bold text-neutral-500 mb-3 flex items-center gap-2 uppercase tracking-wide">
              <BarChart2 size={14}/> 어제({endDate}) 주문량 Top 3
            </h4>
            <div className="space-y-2">
              {summary.topOrders.length > 0 ? summary.topOrders.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm p-2 bg-neutral-50 rounded">
                  <div className="flex items-center gap-3">
                    <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-yellow-400 text-white' : 'bg-neutral-200 text-neutral-600'}`}>
                      {idx + 1}
                    </span>
                    <span className="text-neutral-800 font-medium">{item.name}</span>
                  </div>
                  <span className="font-bold text-blue-600">
                    {formatQty(item.qty, item.umrez, item.unit)}
                  </span>
                </div>
              )) : <div className="text-xs text-neutral-400 text-center py-2">데이터 없음</div>}
            </div>
          </div>

          {/* 재고 타이트 품목 */}
          <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-sm">
            <h4 className="text-xs font-bold text-neutral-500 mb-3 flex items-center gap-2 uppercase tracking-wide">
              <Package size={14}/> 7일 후 재고 최저 예상 Top 3
            </h4>
            <div className="space-y-2">
              {summary.lowestBalance.length > 0 ? summary.lowestBalance.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm p-2 bg-neutral-50 rounded">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded bg-orange-100 text-orange-700 flex items-center justify-center text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <span className="text-neutral-800 font-medium">{item.name}</span>
                  </div>
                  <span className={`font-bold ${item.balance < 0 ? 'text-red-600' : 'text-neutral-700'}`}>
                    {formatQty(item.balance, item.umrez, item.unit)}
                  </span>
                </div>
              )) : <div className="text-xs text-neutral-400 text-center py-2">데이터 없음</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuideItem({ icon, title, desc }: any) {
  return (
    <div className="flex items-start gap-3 p-2">
      <div className="mt-0.5 opacity-80">{icon}</div>
      <div>
        <div className="text-sm font-bold text-neutral-800">{title}</div>
        <p className="text-xs text-neutral-500 leading-snug">{desc}</p>
      </div>
    </div>
  );
}