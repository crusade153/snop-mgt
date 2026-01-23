'use client'

import { useEffect, useState, useMemo } from 'react';
import { getForecastDashboard } from '@/actions/forecast-actions';
import CanvasLineChart from '@/components/charts/canvas-line-chart';
import { 
  RefreshCw, TrendingUp, TrendingDown, Minus, Search, 
  Package, AlertCircle, Info, Calculator, 
  ChevronLeft, ChevronRight, Filter
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store'; 

type TrendFilter = 'ALL' | 'UP' | 'DOWN' | 'STABLE';

export default function ForecastPage() {
  const { unitMode } = useUiStore(); 
  
  // Data State
  const [allItems, setAllItems] = useState<any[]>([]); // 서버에서 가져온 전체 데이터
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<TrendFilter>('ALL');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  useEffect(() => { handleSearch(''); }, []);

  const handleSearch = async (term: string) => {
    setLoading(true);
    // 검색어가 서버로 전달되어 1차 필터링된 데이터를 가져옴
    const res = await getForecastDashboard(term);
    if (res.success) {
      const data = res.data || [];
      setAllItems(data);
      // 데이터가 바뀌면 첫번째 아이템 선택 및 1페이지로 이동
      if (data.length > 0) setSelectedSku(data[0].info.id);
      else setSelectedSku(null);
      setCurrentPage(1);
      setActiveTab('ALL'); // 검색 시 탭 초기화
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(searchTerm); };

  // ✅ [로직] 클라이언트 측 필터링 및 페이징
  const filteredList = useMemo(() => {
    let list = allItems;
    
    // 탭 필터 적용
    if (activeTab !== 'ALL') {
      list = list.filter(item => item.trend === activeTab);
    }
    return list;
  }, [allItems, activeTab]);

  const totalPages = Math.ceil(filteredList.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredList.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const activeItem = allItems.find(i => i.info.id === selectedSku);

  // 차트 데이터 변환
  const convertValue = (val: number) => {
    if (unitMode === 'BOX' && activeItem) {
      return Math.round(val / (activeItem.info.umrezBox || 1));
    }
    return val;
  };

  const historyVals = activeItem?.historical.map((d:any) => convertValue(d.value)) || [];
  const forecastVals = activeItem?.forecast.map((d:any) => convertValue(d.value)) || [];
  const lastYearVals = activeItem?.lastYear?.map((d:any) => convertValue(d.value)) || [];
  const allLabels = activeItem ? [...activeItem.historical, ...activeItem.forecast].map((d:any) => d.date) : [];
  const nextMonthForecast = activeItem ? convertValue(activeItem.forecast[0]?.value || 0) : 0;
  const displayUnit = unitMode === 'BOX' ? 'BOX' : (activeItem?.info.unit || 'EA');

  // 탭 버튼 컴포넌트
  const FilterTab = ({ label, type, count, colorClass }: any) => (
    <button 
      onClick={() => { setActiveTab(type); setCurrentPage(1); }}
      className={`flex-1 py-2 text-xs font-bold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
        activeTab === type 
          ? `border-${colorClass.split('-')[1]}-600 text-${colorClass.split('-')[1]}-700 bg-${colorClass.split('-')[1]}-50` 
          : 'border-transparent text-neutral-500 hover:bg-neutral-50'
      }`}
    >
      {label}
      <span className="bg-white px-1.5 py-0.5 rounded-full text-[10px] border border-neutral-200 shadow-sm">
        {count}
      </span>
    </button>
  );

  // 툴팁 컴포넌트
  const Tooltip = ({ title, formula, desc, questions, direction = 'right' }: { title: string, formula?: string, desc: string, questions?: string[], direction?: 'right' | 'left' }) => (
    <div className={`absolute z-20 hidden group-hover:block w-80 p-4 bg-neutral-900 text-white text-xs rounded-xl shadow-xl -top-2 ${direction === 'right' ? 'left-full ml-4' : 'right-full mr-4'} animate-in fade-in zoom-in-95 duration-200 border border-neutral-700`}>
      <div className={`absolute top-6 w-3 h-3 bg-neutral-900 rotate-45 border-l border-b border-neutral-700 ${direction === 'right' ? '-left-1.5' : '-right-1.5 border-l-0 border-b-0 border-r border-t'}`}></div>
      <div className="relative space-y-3">
        <h4 className="font-bold text-sm text-[#42A5F5] flex items-center gap-2 border-b border-neutral-700 pb-2">
          <Info size={16}/> {title}
        </h4>
        {formula && (
          <div className="bg-neutral-800 p-2.5 rounded-lg border border-neutral-700">
            <div className="text-[10px] text-[#FFA726] font-bold mb-1 flex items-center gap-1">
              <Calculator size={10}/> 계산 공식 (Formula)
            </div>
            <code className="text-neutral-300 font-mono text-xs block leading-relaxed">{formula}</code>
          </div>
        )}
        <p className="leading-relaxed text-neutral-300">{desc}</p>
        {questions && (
          <div className="space-y-2 pt-2 border-t border-neutral-700">
            {questions.map((q, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="text-[#42A5F5] font-bold shrink-0">Q.</span>
                <span className="text-neutral-400 leading-snug">{q}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] animate-in fade-in slide-in-from-bottom-4">
      <div className="pb-4 border-b border-neutral-200 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">🔮 수요 예측 (Sales Forecast)</h1>
          <p className="text-sm text-neutral-500 mt-1">과거 6개월 데이터 기반 향후 6개월 수요 시뮬레이션 (전년 동월 비교 포함)</p>
        </div>
        <button onClick={() => handleSearch(searchTerm)} className="flex items-center gap-2 px-3 py-2 bg-neutral-900 text-white rounded-lg text-sm font-bold hover:bg-neutral-700 transition-colors">
          <RefreshCw size={14} /> 데이터 갱신
        </button>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* 좌측: 리스트 & 필터 */}
        <div className="w-[340px] flex flex-col bg-white border border-neutral-200 rounded-xl shadow-sm">
          
          {/* 검색 영역 */}
          <div className="p-4 border-b border-neutral-200 bg-neutral-50 rounded-t-xl space-y-3">
            <h2 className="font-bold text-neutral-800 text-sm flex items-center gap-2">
              <Filter size={14}/> 예측 분석 대상
            </h2>
            <div className="relative">
              <input 
                type="text" 
                placeholder="품목명 검색 (Enter)" 
                value={searchTerm} 
                onChange={(e) => setSearchTerm(e.target.value)} 
                onKeyDown={handleKeyDown} 
                className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-primary-blue bg-white" 
              />
              <Search size={14} className="absolute left-3 top-2.5 text-neutral-400" />
            </div>
          </div>

          {/* 트렌드 탭 필터 */}
          <div className="flex border-b border-neutral-200 bg-white">
            <FilterTab label="전체" type="ALL" count={allItems.length} colorClass="text-neutral" />
            <FilterTab label="상승" type="UP" count={allItems.filter(i=>i.trend==='UP').length} colorClass="text-red" />
            <FilterTab label="하락" type="DOWN" count={allItems.filter(i=>i.trend==='DOWN').length} colorClass="text-blue" />
          </div>

          {/* 리스트 영역 (스크롤) */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="p-10 text-center text-sm text-neutral-400">분석 중...</div>
            ) : filteredList.length === 0 ? (
              <div className="p-10 text-center text-sm text-neutral-400">데이터가 없습니다.</div>
            ) : (
              paginatedItems.map((item) => {
                const isSelected = item.info.id === selectedSku;
                return (
                  <button 
                    key={item.info.id} 
                    onClick={() => setSelectedSku(item.info.id)} 
                    className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between group ${isSelected ? 'bg-[#E3F2FD] border-[#BBDEFB] shadow-sm' : 'bg-white border-transparent hover:bg-neutral-50 hover:border-neutral-200'}`}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      {/* ✅ [수정] 텍스트 줄바꿈 및 말줄임 해제, 최대 2줄까지만 표시 */}
                      <div className={`font-bold text-sm leading-snug line-clamp-2 break-words ${isSelected ? 'text-[#1565C0]' : 'text-neutral-700'}`}>
                        {item.info.name}
                      </div>
                      <div className="text-[11px] text-neutral-400 font-mono mt-1">{item.info.id}</div>
                    </div>
                    
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <div className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${item.trend === 'UP' ? 'bg-red-50 text-red-600 border border-red-100' : item.trend === 'DOWN' ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-neutral-100 text-neutral-500'}`}>
                        {item.trend === 'UP' ? <TrendingUp size={10} /> : item.trend === 'DOWN' ? <TrendingDown size={10} /> : <Minus size={10} />}
                        {Math.abs(item.changeRate).toFixed(0)}%
                      </div>
                      {/* 신뢰도 표시 (작게) */}
                      <div className={`text-[9px] font-medium ${item.metrics.accuracy < 50 ? 'text-red-400' : 'text-green-600'}`}>
                        신뢰 {item.metrics.accuracy}%
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* 페이지네이션 컨트롤 */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-neutral-200 bg-neutral-50 flex justify-between items-center rounded-b-xl">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30"
              >
                <ChevronLeft size={16}/>
              </button>
              <span className="text-xs font-bold text-neutral-600">
                {currentPage} / {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30"
              >
                <ChevronRight size={16}/>
              </button>
            </div>
          )}
        </div>

        {/* 우측: 상세 분석 */}
        <div className="flex-1 flex flex-col space-y-6 overflow-y-auto pr-2">
          {activeItem ? (
            <>
              {/* 3대 핵심 지표 카드 */}
              <div className="grid grid-cols-3 gap-4">
                
                {/* 1. 예측 트렌드 카드 */}
                <div className={`p-5 rounded-xl border shadow-sm group relative cursor-help transition-all hover:ring-2 hover:ring-offset-2 ${activeItem.trend === 'UP' ? 'bg-[#FFEBEE] border-[#FFCDD2] hover:ring-[#E53935]' : activeItem.trend === 'DOWN' ? 'bg-[#E3F2FD] border-[#BBDEFB] hover:ring-[#1565C0]' : 'bg-white border-neutral-200 hover:ring-neutral-400'}`}>
                  <div className="text-xs font-bold opacity-60 mb-1 flex items-center gap-1 text-neutral-700">
                    <TrendingUp size={14} /> 예측 트렌드 (Trend)
                  </div>
                  <div className={`text-2xl font-bold ${activeItem.trend === 'UP' ? 'text-[#C62828]' : activeItem.trend === 'DOWN' ? 'text-[#1565C0]' : 'text-neutral-700'}`}>
                    {activeItem.trend === 'UP' ? '상승세 (Growth)' : activeItem.trend === 'DOWN' ? '하락세 (Decline)' : '보합 (Stable)'}
                  </div>
                  <div className="text-xs opacity-60 mt-1 text-neutral-700 font-medium">
                    과거 대비 {activeItem.changeRate > 0 ? '+' : ''}{activeItem.changeRate.toFixed(1)}% 변동 예상
                  </div>
                  <Tooltip 
                    title="트렌드란 무엇인가요?"
                    formula="(예측평균 - 과거평균) ÷ 과거평균 × 100"
                    desc="과거 6개월의 평균 판매량과 향후 6개월 예측값의 평균을 비교하여, 전반적인 성장률을 계산합니다."
                    direction="right"
                  />
                </div>

                {/* 2. 다음 달 예상 카드 */}
                <div className="p-5 bg-white border border-neutral-200 rounded-xl shadow-sm group relative cursor-help transition-all hover:border-blue-400 hover:ring-2 hover:ring-blue-400 hover:ring-offset-2">
                  <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                    <Package size={14} /> 다음 달 예상 판매량
                  </div>
                  <div className="text-2xl font-bold text-neutral-900">
                    {nextMonthForecast.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-neutral-400">{displayUnit}</span>
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">추세선(Trend Line) 기준 예측값</div>
                  <Tooltip 
                    title="어떻게 계산된 숫자인가요?"
                    formula="y = ax + b (선형 회귀 방정식)"
                    desc="단순 평균이 아니라, 전체적인 데이터의 흐름(추세선)을 그렸을 때 다음 달에 위치하게 되는 점의 값입니다."
                    direction="right"
                  />
                </div>

                {/* 3. 신뢰도 카드 */}
                <div className={`p-5 bg-white border border-neutral-200 rounded-xl shadow-sm group relative cursor-help transition-all hover:ring-2 hover:ring-offset-2 ${activeItem.metrics.accuracy < 50 ? 'hover:border-red-400 hover:ring-red-400' : 'hover:border-green-500 hover:ring-green-500'}`}>
                  <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                    <AlertCircle size={14} /> 예측 신뢰도 (Accuracy)
                  </div>
                  <div className={`text-2xl font-bold ${activeItem.metrics.accuracy < 50 ? 'text-red-500' : 'text-[#2E7D32]'}`}>
                    {activeItem.metrics.accuracy}%
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    {activeItem.metrics.accuracy < 50 ? '⚠️ 변동성이 매우 큽니다' : '안정적인 패턴입니다'}
                  </div>
                  <Tooltip 
                    title="신뢰도가 왜 100%가 아닌가요?"
                    formula="100 - (표준편차 ÷ 평균판매량 × 100)"
                    desc="과거 판매량이 얼마나 일정했는지를 나타냅니다. 판매량이 불규칙할수록 신뢰도는 떨어지지만, 추세는 참고할 수 있습니다."
                    direction="left"
                  />
                </div>
              </div>

              {/* 차트 영역 */}
              <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm min-h-[400px]">
                <h3 className="font-bold text-lg mb-6 text-neutral-800 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span>📈 수요 흐름 분석</span>
                    <span className="text-xs font-normal text-neutral-400 bg-neutral-100 px-2 py-1 rounded">실선: 실적 / 점선: 예측 / <span className="font-bold text-gray-400">회색: 전년동월</span></span>
                  </div>
                  <span className="text-xs font-normal text-neutral-500 bg-neutral-100 px-2 py-1 rounded">단위: {displayUnit}</span>
                </h3>
                <div className="h-[350px] w-full">
                  <CanvasLineChart 
                    historyData={historyVals} 
                    forecastData={forecastVals}
                    lastYearData={lastYearVals} // ✅ 전년 데이터 전달
                    labels={allLabels} 
                  />
                </div>
              </div>
            </>
          ) : (<div className="flex items-center justify-center h-full text-neutral-400">좌측 목록에서 분석할 품목을 선택해주세요.</div>)}
        </div>
      </div>
    </div>
  );
}