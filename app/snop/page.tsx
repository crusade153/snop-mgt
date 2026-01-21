'use client';

import { useState, useRef, useEffect } from 'react';
import { getSnopPlan } from '@/actions/snop-actions';
import { searchProducts } from '@/actions/simulation-actions'; 
import { useSnopStore } from '@/store/snop-store';
import WeeklyGrid from '@/components/snop/weekly-grid';
import CanvasLineChart from '@/components/charts/canvas-line-chart';
import { Search, RotateCcw, Save, AlertCircle, CalendarRange, Clock, Package } from 'lucide-react';
import { addDays, format } from 'date-fns';

export default function SnopPlannerPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);

  const [planMode, setPlanMode] = useState<'WEEK' | 'DAY'>('WEEK');
  const [weekDuration, setWeekDuration] = useState(4); 
  const [dayRange, setDayRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(addDays(new Date(), 9), 'yyyy-MM-dd')
  });

  const { productName, productCode, startStock, items, setInitialData, reset } = useSnopStore();

  // 검색 실행
  const executeSearch = async (product: any) => {
    setSearchTerm(`${product.MATNR_T}`); 
    setSearchResults([]); 
    setLoading(true);
    reset();

    const options = {
      mode: planMode,
      weekCount: planMode === 'WEEK' ? weekDuration : undefined,
      startDate: planMode === 'DAY' ? dayRange.start : undefined,
      endDate: planMode === 'DAY' ? dayRange.end : undefined,
    };

    const res = await getSnopPlan(product.MATNR, options);

    if (res.success && res.data) {
      setInitialData(product.MATNR_T, product.MATNR, res.data.currentStock, res.data.planData);
    } else {
      alert('데이터 로드 실패: ' + res.message);
    }
    setLoading(false);
  };

  // 검색어 입력 (Debounce)
  const handleSearchInput = (term: string) => {
    setSearchTerm(term);
    
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (term.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await searchProducts(term);
        setSearchResults(res);
      } catch (error) {
        console.error("Search failed", error);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  // 엔터 키
  const handleEnterKey = async () => {
    if (!searchTerm) return;
    
    if (searchResults.length > 0) {
      executeSearch(searchResults[0]);
      return;
    }

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    setLoading(true);
    const res = await searchProducts(searchTerm);
    if (res && res.length > 0) {
      executeSearch(res[0]);
    } else {
      alert("해당하는 제품을 찾을 수 없습니다.");
      setLoading(false);
    }
  };

  // 🚨 [수정] 완벽한 초기화 함수
  const handleFullReset = () => {
    setSearchTerm('');       // 검색어 지움
    setSearchResults([]);    // 검색 목록 지움
    setLoading(false);       // 로딩 끔
    reset();                 // Store 데이터(화면 내용) 싹 비움
  };

  const chartLabels = items.map(i => i.period);
  const stockFlow = items.map(i => i.eoh);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* 1. 컨트롤 타워 */}
      <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm flex flex-col md:flex-row gap-6 justify-between items-end">
        <div className="space-y-3 w-full md:w-auto">
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            📅 S&OP 플래너 설정
          </h1>
          
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex bg-neutral-100 p-1 rounded-lg">
              <button 
                onClick={() => setPlanMode('WEEK')}
                className={`px-3 py-1.5 text-sm font-bold rounded-md transition-all ${planMode === 'WEEK' ? 'bg-white shadow text-blue-700' : 'text-neutral-500'}`}
              >
                주간 (Weekly)
              </button>
              <button 
                onClick={() => setPlanMode('DAY')}
                className={`px-3 py-1.5 text-sm font-bold rounded-md transition-all ${planMode === 'DAY' ? 'bg-white shadow text-green-700' : 'text-neutral-500'}`}
              >
                일별 (Daily)
              </button>
            </div>

            {planMode === 'WEEK' ? (
              <div className="flex items-center gap-2 bg-neutral-50 px-3 py-1.5 rounded-lg border border-neutral-200">
                <Clock size={14} className="text-neutral-400"/>
                <select 
                  value={weekDuration}
                  onChange={(e) => setWeekDuration(Number(e.target.value))}
                  className="bg-transparent text-sm font-bold text-neutral-700 outline-none cursor-pointer"
                >
                  {[2, 3, 4, 5, 6, 7, 8].map(week => (
                    <option key={week} value={week}>{week}주 계획</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-neutral-50 px-3 py-1.5 rounded-lg border border-neutral-200">
                <CalendarRange size={14} className="text-neutral-400"/>
                <input 
                  type="date" 
                  value={dayRange.start}
                  onChange={(e) => setDayRange({...dayRange, start: e.target.value})}
                  className="bg-transparent text-xs font-bold text-neutral-700 outline-none w-[85px]"
                />
                <span className="text-neutral-400 text-xs">~</span>
                <input 
                  type="date" 
                  value={dayRange.end}
                  onChange={(e) => setDayRange({...dayRange, end: e.target.value})}
                  className="bg-transparent text-xs font-bold text-neutral-700 outline-none w-[85px]"
                />
              </div>
            )}
          </div>
        </div>

        <div className="relative w-full md:w-96">
          <input 
            type="text" 
            placeholder="제품명 또는 코드 검색 (예: 만두, 1001)"
            value={searchTerm}
            onChange={e => handleSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleEnterKey()}
            className="w-full pl-10 pr-10 py-3 border border-neutral-300 rounded-xl focus:outline-none focus:border-neutral-900 shadow-sm transition-all"
          />
          <Search className="absolute left-3 top-3.5 text-neutral-400" size={18} />
          {isSearching && (
            <div className="absolute right-3 top-3.5">
              <div className="w-4 h-4 border-2 border-neutral-200 border-t-neutral-500 rounded-full animate-spin"></div>
            </div>
          )}
          
          {searchResults.length > 0 && (
            <ul className="absolute top-full mt-2 w-full bg-white border border-neutral-200 rounded-xl shadow-xl max-h-60 overflow-y-auto z-50 animate-in fade-in slide-in-from-top-2">
              {searchResults.map((p, idx) => (
                <li 
                  key={idx}
                  onClick={() => executeSearch(p)}
                  className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-0 flex justify-between items-center group"
                >
                  <div>
                    <div className="font-bold text-neutral-800 text-sm group-hover:text-blue-700">{p.MATNR_T}</div>
                    <div className="text-xs text-neutral-400 font-mono flex items-center gap-1 mt-0.5">
                      <span className="bg-neutral-100 px-1 rounded text-neutral-500">CODE</span> {p.MATNR}
                    </div>
                  </div>
                  <span className="text-xs bg-neutral-100 text-neutral-500 px-2 py-1 rounded group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">선택</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 2. 메인 콘텐츠 */}
      {items.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm space-y-4">
              <div className="flex justify-between items-start">
                <div className="text-sm font-bold text-neutral-500">Target Product</div>
                <span className="bg-neutral-100 text-neutral-600 px-2 py-1 rounded text-xs font-mono font-bold">
                  {productCode}
                </span>
              </div>
              <div className="text-xl font-bold text-neutral-900 leading-tight">{productName}</div>
              
              <div className="flex gap-4 pt-4 border-t border-neutral-100">
                <div>
                  <div className="text-xs text-neutral-500 mb-1">현재고 (Start)</div>
                  <div className="text-xl font-bold text-neutral-800">{startStock.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-1">설정 기간</div>
                  <div className="text-xl font-bold text-primary-blue">
                    {planMode === 'WEEK' ? `${weekDuration} Weeks` : `${items.length} Days`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-4">
                {/* 🚨 초기화 버튼에 handleFullReset 연결 */}
                <button className="flex-1 py-2 border border-neutral-300 rounded hover:bg-neutral-50 flex items-center justify-center gap-1 text-sm font-medium transition-colors" onClick={handleFullReset}>
                  <RotateCcw size={14}/> 초기화
                </button>
                <button className="flex-1 py-2 bg-neutral-900 text-white rounded hover:bg-neutral-700 shadow-sm flex items-center justify-center gap-1 text-sm font-bold transition-colors" onClick={() => alert('계획이 확정되었습니다. (DB 저장)')}>
                  <Save size={14}/> 계획 확정
                </button>
              </div>
            </div>

            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
              <h3 className="font-bold text-lg mb-4 text-neutral-800 flex items-center gap-2">
                📊 예상 재고 시뮬레이션
              </h3>
              <div className="h-[200px] w-full">
                <CanvasLineChart 
                  historyData={stockFlow} 
                  forecastData={[]} 
                  labels={chartLabels} 
                  height={200}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg text-neutral-900">📝 수급 계획표 ({planMode === 'WEEK' ? 'Weekly' : 'Daily'})</h3>
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                <AlertCircle size={14}/>
                <span>숫자를 수정하면 즉시 재계산됩니다.</span>
              </div>
            </div>
            <WeeklyGrid />
          </div>
        </div>
      ) : (
        !loading && (
          <div className="h-[400px] flex flex-col items-center justify-center text-neutral-400 border-2 border-dashed border-neutral-200 rounded-xl bg-neutral-50/50">
            <Package size={48} className="mb-4 opacity-20" />
            <p className="font-medium text-neutral-500">기간을 설정하고 제품을 검색하세요.</p>
            <p className="text-sm text-neutral-400 mt-2">제품명 또는 코드(예: 1001)로 검색 가능</p>
          </div>
        )
      )}
    </div>
  );
}