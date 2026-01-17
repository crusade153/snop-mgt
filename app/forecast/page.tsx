'use client'

import { useEffect, useState } from 'react';
import { getForecastDashboard } from '@/actions/forecast-actions';
import CanvasLineChart from '@/components/charts/canvas-line-chart';
import { 
  RefreshCw, TrendingUp, TrendingDown, Minus, 
  Search, Package, AlertCircle, HelpCircle 
} from 'lucide-react';

export default function ForecastPage() {
  const [items, setItems] = useState<any[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 초기 로딩 (Top 10)
  useEffect(() => {
    handleSearch('');
  }, []);

  const handleSearch = async (term: string) => {
    setLoading(true);
    const res = await getForecastDashboard(term);
    if (res.success) {
      // 🚨 [수정] 타입 에러 방지: 데이터가 undefined일 경우 빈 배열 할당
      const data = res.data || [];
      setItems(data);
      
      if (data.length > 0) {
        setSelectedSku(data[0].info.id);
      } else {
        setSelectedSku(null);
      }
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch(searchTerm);
    }
  };

  const activeItem = items.find(i => i.info.id === selectedSku);

  // 차트 데이터 분리
  const historyVals = activeItem?.historical.map((d:any) => d.value) || [];
  const forecastVals = activeItem?.forecast.map((d:any) => d.value) || [];
  const allLabels = activeItem 
    ? [...activeItem.historical, ...activeItem.forecast].map((d:any) => d.date)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] animate-in fade-in slide-in-from-bottom-4">
      
      {/* 1. Header with Updated Tooltip */}
      <div className="pb-4 border-b border-neutral-200 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            🔮 수요 예측 (Sales Forecast)
          </h1>
          
          <div className="mt-2 flex items-center gap-2 text-sm text-neutral-600 bg-blue-50 border border-blue-100 px-3 py-2 rounded-lg w-fit">
            <HelpCircle size={16} className="text-primary-blue" />
            <span>
              <strong>산출 기준:</strong> 과거 판매 데이터의 <strong>기울기(추세)</strong>를 분석하는 
              <strong>선형 회귀(Linear Regression)</strong> 모델을 사용하여 상승/하락세를 반영합니다.
            </span>
          </div>
        </div>
        <button onClick={() => handleSearch(searchTerm)} className="flex items-center gap-2 px-3 py-2 bg-neutral-900 text-white rounded-lg text-sm font-bold hover:bg-neutral-700 transition-colors">
          <RefreshCw size={14} /> 데이터 갱신
        </button>
      </div>

      <div className="flex gap-6 flex-1 overflow-hidden">
        
        {/* Left Sidebar: List */}
        <div className="w-[320px] flex flex-col bg-white border border-neutral-200 rounded-xl shadow-sm">
          <div className="p-4 border-b border-neutral-200 bg-neutral-50 rounded-t-xl">
            <h2 className="font-bold text-neutral-800 mb-2 text-sm">
              {searchTerm ? '🔍 검색 결과 (전체 품목)' : '🏆 납품금액 Top 10 (최근 3개월)'}
            </h2>
            <div className="relative">
              <input 
                type="text" 
                placeholder="품목명 검색 (Enter)" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-primary-blue" 
              />
              <Search size={14} className="absolute left-3 top-2.5 text-neutral-400" />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="p-10 text-center text-sm text-neutral-400">조회 중...</div>
            ) : items.length === 0 ? (
              <div className="p-10 text-center text-sm text-neutral-400">검색 결과가 없습니다.</div>
            ) : items.map((item) => {
              const isSelected = item.info.id === selectedSku;
              const isUp = item.trend === 'UP';
              const isDown = item.trend === 'DOWN';
              
              return (
                <button
                  key={item.info.id}
                  onClick={() => setSelectedSku(item.info.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between group ${
                    isSelected 
                      ? 'bg-[#E3F2FD] border-[#BBDEFB] shadow-sm' 
                      : 'bg-white border-transparent hover:bg-neutral-50 hover:border-neutral-200'
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className={`font-bold text-sm truncate ${isSelected ? 'text-[#1565C0]' : 'text-neutral-700'}`}>
                      {item.info.name}
                    </div>
                    <div className="text-xs text-neutral-400 font-mono mt-0.5">{item.info.id}</div>
                  </div>
                  
                  <div className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                    isUp ? 'bg-red-100 text-red-600' : 
                    isDown ? 'bg-blue-100 text-blue-600' : 'bg-neutral-100 text-neutral-500'
                  }`}>
                    {isUp ? <TrendingUp size={12} /> : isDown ? <TrendingDown size={12} /> : <Minus size={12} />}
                    {Math.abs(item.changeRate).toFixed(0)}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Content: Detail */}
        <div className="flex-1 flex flex-col space-y-6 overflow-y-auto pr-2">
          {activeItem ? (
            <>
              {/* Insight Cards */}
              <div className="grid grid-cols-3 gap-4">
                
                {/* 1. Trend */}
                <div className={`p-5 rounded-xl border shadow-sm ${
                  activeItem.trend === 'UP' ? 'bg-[#FFEBEE] border-[#FFCDD2]' : 
                  activeItem.trend === 'DOWN' ? 'bg-[#E3F2FD] border-[#BBDEFB]' : 'bg-white border-neutral-200'
                }`}>
                  <div className="text-xs font-bold opacity-60 mb-1 flex items-center gap-1 text-neutral-700">
                    <TrendingUp size={14} /> 예측 트렌드 (Trend)
                  </div>
                  <div className={`text-2xl font-bold ${
                    activeItem.trend === 'UP' ? 'text-[#C62828]' : 
                    activeItem.trend === 'DOWN' ? 'text-[#1565C0]' : 'text-neutral-700'
                  }`}>
                    {activeItem.trend === 'UP' ? '상승세 (Growth)' : 
                     activeItem.trend === 'DOWN' ? '하락세 (Decline)' : '보합세 (Stable)'}
                  </div>
                  <div className="text-xs opacity-60 mt-1 text-neutral-700 font-medium">
                    과거 대비 {activeItem.changeRate > 0 ? '+' : ''}{activeItem.changeRate.toFixed(1)}% 변동 예상
                  </div>
                </div>

                {/* 2. Forecast Qty (Tooltip Update) */}
                <div className="p-5 bg-white border border-neutral-200 rounded-xl shadow-sm group relative cursor-help">
                  <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                    <Package size={14} /> 다음 달 예상 판매량 <HelpCircle size={12} className="text-neutral-300"/>
                  </div>
                  <div className="text-2xl font-bold text-neutral-900">
                    {activeItem.forecast[0]?.value.toLocaleString()} <span className="text-sm font-normal text-neutral-400">EA</span>
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    추세선(Trend Line) 기준 예측값
                  </div>
                  
                  {/* Tooltip Content */}
                  <div className="absolute hidden group-hover:block top-full left-0 mt-2 p-3 bg-gray-800 text-white text-xs rounded z-10 w-64 shadow-lg">
                    <strong>🧮 계산식 (선형 회귀):</strong><br/>
                    과거 데이터의 기울기(Slope)를 구해<br/>
                    미래 시점의 값을 계산했습니다.<br/>
                    (단순 평균보다 추세 반영에 유리함)
                  </div>
                </div>

                {/* 3. Accuracy */}
                <div className="p-5 bg-white border border-neutral-200 rounded-xl shadow-sm group relative cursor-help">
                  <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                    <AlertCircle size={14} /> 예측 신뢰도 <HelpCircle size={12} className="text-neutral-300"/>
                  </div>
                  <div className="text-2xl font-bold text-[#2E7D32]">
                    {activeItem.metrics.accuracy}%
                  </div>
                  <div className="text-xs text-neutral-400 mt-1">
                    변동성 기반 신뢰 점수
                  </div>

                  {/* Tooltip Content */}
                  <div className="absolute hidden group-hover:block top-full right-0 mt-2 p-3 bg-gray-800 text-white text-xs rounded z-10 w-64 shadow-lg">
                    <strong>🧮 계산식:</strong><br/>
                    100 - (표준편차 ÷ 평균 × 100)<br/>
                    * 실적이 들쭉날쭉할수록(변동성이 크면) 신뢰도는 낮아집니다.
                  </div>
                </div>
              </div>

              {/* Chart Section */}
              <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm min-h-[400px]">
                <h3 className="font-bold text-lg mb-6 text-neutral-800 flex justify-between">
                  <span>📈 수요 흐름 분석 (추세선 적용)</span>
                  <span className="text-xs font-normal text-neutral-500 bg-neutral-100 px-2 py-1 rounded">Model: Linear Regression</span>
                </h3>
                
                <div className="h-[350px] w-full">
                  <CanvasLineChart 
                    historyData={historyVals}
                    forecastData={forecastVals}
                    labels={allLabels}
                  />
                </div>
                
                {/* Legend */}
                <div className="flex justify-center gap-8 mt-6 text-xs font-bold text-neutral-500">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-0.5 bg-[#4A90E2]"></div> 실제 판매 실적 (History)
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-0.5 bg-[#E53935] border-b border-dashed"></div> AI 추세 예측 (Trend Forecast)
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-400">
              좌측 목록에서 분석할 품목을 선택해주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}