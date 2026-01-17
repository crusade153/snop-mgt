'use client'

import { useState } from 'react';
import { searchProducts, executeInventorySimulation } from '@/actions/simulation-actions';
import InventoryBalanceChart from '@/components/charts/inventory-balance-chart';
import { 
  Search, Play, Calendar, AlertTriangle, CheckCircle, Package, Truck, ShoppingCart, RefreshCw, XCircle, Factory 
} from 'lucide-react';

export default function SimulationPage() {
  // 1. 검색 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // 2. 시뮬레이션 입력값
  const [params, setParams] = useState({
    minShelfLife: 30, // 기본 30일 이상 남은것만
    additionalQty: 1000,
    targetDate: new Date().toISOString().slice(0, 10)
  });

  // 3. 결과 상태
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // 제품 검색 핸들러
  const handleSearch = async () => {
    if (!searchTerm) return;
    const res = await searchProducts(searchTerm);
    setSearchResults(res);
  };

  // 시뮬레이션 실행 핸들러
  const handleRun = async () => {
    if (!selectedProduct) return alert("제품을 먼저 선택해주세요.");
    setLoading(true);
    const res = await executeInventorySimulation(selectedProduct.MATNR, {
      productName: selectedProduct.MATNR_T,
      ...params
    });
    if (res.success) {
      setResult(res.data);
    } else {
      alert("시뮬레이션 실패: " + res.message);
    }
    setLoading(false);
  };

  const handleReset = () => {
    setResult(null);
    setParams({
      minShelfLife: 30,
      additionalQty: 1000,
      targetDate: new Date().toISOString().slice(0, 10)
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          🧪 납품 가능 여부 시뮬레이션 (ATP Check)
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          "이 물량, 언제까지 납품 가능한가?" 현재 재고와 생산 계획을 기반으로 공급 가능성을 진단합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* 1. 설정 패널 (좌측) */}
        <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm space-y-6 h-fit">
          
          {/* (1) 제품 검색 */}
          <div>
            <label className="text-sm font-bold text-neutral-700 block mb-2">1. 대상 품목 검색</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="제품명 입력 (예: 미식)" 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="flex-1 p-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-primary-blue"
              />
              <button onClick={handleSearch} className="p-2 bg-neutral-100 rounded-lg hover:bg-neutral-200">
                <Search size={18} className="text-neutral-600"/>
              </button>
            </div>
            
            {/* 검색 결과 리스트 */}
            {searchResults.length > 0 && !selectedProduct && (
              <ul className="mt-2 border border-neutral-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                {/* ✅ 수정된 부분: index를 키에 포함하여 중복 에러 해결 */}
                {searchResults.map((p, index) => (
                  <li 
                    key={`${p.MATNR}-${index}`} 
                    onClick={() => { setSelectedProduct(p); setSearchResults([]); }}
                    className="p-2 text-sm hover:bg-blue-50 cursor-pointer border-b last:border-0"
                  >
                    <div className="font-bold text-neutral-800">{p.MATNR_T}</div>
                    <div className="text-xs text-neutral-400">{p.MATNR}</div>
                  </li>
                ))}
              </ul>
            )}

            {/* 선택된 제품 표시 */}
            {selectedProduct && (
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg flex justify-between items-center">
                <div>
                  <div className="text-xs text-blue-600 font-bold">선택됨</div>
                  <div className="text-sm font-bold text-neutral-800">{selectedProduct.MATNR_T}</div>
                </div>
                <button onClick={() => setSelectedProduct(null)} className="text-xs text-neutral-400 underline">변경</button>
              </div>
            )}
          </div>

          {/* (2) 재고 필터링 조건 */}
          <div>
            <label className="text-sm font-bold text-neutral-700 block mb-2">2. 유효 재고 기준</label>
            <div className="flex items-center gap-2 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <Calendar size={16} className="text-neutral-500"/>
              <span className="text-sm text-neutral-600">잔여 유통기한</span>
              <input 
                type="number" 
                value={params.minShelfLife}
                onChange={e => setParams({...params, minShelfLife: Number(e.target.value)})}
                className="w-16 p-1 text-center font-bold border border-neutral-300 rounded"
              />
              <span className="text-sm text-neutral-600">일 이상</span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">* 해당 기간 미만 재고는 시뮬레이션에서 제외됩니다.</p>
          </div>

          {/* (3) 추가 주문 정보 */}
          <div>
            <label className="text-sm font-bold text-neutral-700 block mb-2">3. 추가 요청 정보</label>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-neutral-500 block mb-1">납품 희망일</span>
                <input 
                  type="date" 
                  value={params.targetDate}
                  onChange={e => setParams({...params, targetDate: e.target.value})}
                  className="w-full p-2 text-sm border border-neutral-300 rounded-lg"
                />
              </div>
              <div>
                <span className="text-xs text-neutral-500 block mb-1">필요 수량 (EA)</span>
                <input 
                  type="number" 
                  value={params.additionalQty}
                  onChange={e => setParams({...params, additionalQty: Number(e.target.value)})}
                  className="w-full p-2 text-sm font-bold border border-neutral-300 rounded-lg text-primary-blue"
                />
              </div>
            </div>
          </div>

          <button 
            onClick={handleRun}
            disabled={!selectedProduct || loading}
            className="w-full bg-neutral-900 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all disabled:opacity-50"
          >
            {loading ? '계산 중...' : <><Play size={16} /> 가능 여부 확인</>}
          </button>
        </div>

        {/* 2. 결과 리포트 패널 (우측) */}
        <div className="lg:col-span-2">
          {result ? (
            <div className="space-y-6">
              
              {/* 판정 배너 */}
              <div className={`p-6 rounded-xl border-l-8 shadow-sm flex items-start gap-4 ${
                result.isPossible ? 'bg-green-50 border-green-500 text-green-900' : 'bg-red-50 border-red-500 text-red-900'
              }`}>
                {result.isPossible ? <CheckCircle size={32} className="text-green-600"/> : <AlertTriangle size={32} className="text-red-600"/>}
                <div>
                  <h3 className="font-bold text-xl mb-1">
                    {result.isPossible ? '납품 가능합니다! (Possible)' : '재고가 부족합니다 (Shortage)'}
                  </h3>
                  <p className="text-sm opacity-90">
                    {result.isPossible 
                      ? `요청하신 날짜(${params.targetDate})에 안정적으로 공급 가능합니다.` 
                      : `죄송합니다. ${result.shortageDate}에 ${result.shortageQty.toLocaleString()}개가 부족할 것으로 예상됩니다.`}
                  </p>
                </div>
              </div>

              {/* 요약 카드 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 bg-white border border-neutral-200 rounded-xl">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><Package size={14}/> 현재 유효 재고</div>
                  <div className="text-xl font-bold">{result.currentUsableStock.toLocaleString()}</div>
                  <div className="text-xs text-neutral-400">잔여 {params.minShelfLife}일 이상</div>
                </div>
                <div className="p-4 bg-white border border-neutral-200 rounded-xl">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><Truck size={14}/> 미래 입고 예정</div>
                  <div className="text-xl font-bold text-blue-600">+{result.totalProduction.toLocaleString()}</div>
                  <div className="text-xs text-neutral-400">생산 계획 합계</div>
                </div>
                <div className="p-4 bg-white border border-neutral-200 rounded-xl">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><ShoppingCart size={14}/> 신규 요청</div>
                  <div className="text-xl font-bold text-red-600">-{params.additionalQty.toLocaleString()}</div>
                  <div className="text-xs text-neutral-400">{params.targetDate} 출고</div>
                </div>
              </div>

              {/* 일자별 재고 흐름 차트 */}
              <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
                <h3 className="font-bold text-lg mb-4 text-neutral-800 flex items-center gap-2">
                  📅 일자별 예상 재고 추이 (Inventory Balance)
                </h3>
                <div className="h-[300px] w-full">
                  <InventoryBalanceChart timeline={result.timeline} />
                </div>
                <div className="text-center mt-4 text-xs text-neutral-500">
                  <span className="text-red-500 font-bold">점선 아래(음수)</span> 영역이 발생하면 해당 일자에 결품이 발생한다는 의미입니다.
                </div>
              </div>

              <div className="text-right">
                <button onClick={handleReset} className="text-sm text-neutral-500 hover:text-neutral-800 underline flex items-center gap-1 justify-end w-full">
                  <RefreshCw size={12} /> 다른 조건으로 다시하기
                </button>
              </div>

            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-neutral-50 rounded-xl border border-dashed border-neutral-300 text-neutral-400 min-h-[400px]">
              <Package size={48} className="text-neutral-200 mb-4" />
              <p>좌측에서 제품과 조건을 입력하고</p>
              <p><strong>가능 여부 확인</strong> 버튼을 눌러주세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}