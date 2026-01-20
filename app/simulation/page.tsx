'use client'

import { useState } from 'react';
import { searchProducts, executeInventorySimulation } from '@/actions/simulation-actions';
import InventoryBalanceChart from '@/components/charts/inventory-balance-chart';
import { 
  Search, Play, Calendar, AlertTriangle, CheckCircle, 
  Package, Truck, ShoppingCart, RefreshCw, XCircle, 
  Factory, ArrowRight, ClipboardList 
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store'; 

export default function SimulationPage() {
  const { unitMode } = useUiStore(); // 단위 상태 (BOX / BASE)
  
  // 1. 검색 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // 2. 시뮬레이션 입력값 (기준 단위로 저장)
  const [baseQty, setBaseQty] = useState<number>(1000); // EA/KG 기준
  const [minShelfLife, setMinShelfLife] = useState(30);
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));

  // 3. 결과 상태
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Helper: 단위 변환 (보여줄 때)
  const formatQty = (val: number) => {
    const umrez = selectedProduct?.UMREZ_BOX || 1;
    if (unitMode === 'BOX') {
      return (val / umrez).toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
    return val.toLocaleString();
  };

  // Helper: 입력값 처리 (입력 -> 기준단위 저장)
  const handleQtyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const umrez = selectedProduct?.UMREZ_BOX || 1;
    if (unitMode === 'BOX') {
      setBaseQty(val * umrez); // BOX 입력 -> EA 저장
    } else {
      setBaseQty(val);
    }
  };

  const handleSearch = async () => {
    if (!searchTerm) return;
    const res = await searchProducts(searchTerm);
    setSearchResults(res);
  };

  const handleRun = async () => {
    if (!selectedProduct) return alert("제품을 먼저 선택해주세요.");
    setLoading(true);
    const res = await executeInventorySimulation(selectedProduct.MATNR, {
      productName: selectedProduct.MATNR_T,
      minShelfLife,
      targetDate,
      additionalQty: baseQty // 기준 단위로 전송
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
    setBaseQty(1000);
    setMinShelfLife(30);
    setTargetDate(new Date().toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          🧪 납품 가능 여부 시뮬레이션 (ATP Check)
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          기수요(기존 주문)를 우선 차감한 후 공급 가능성을 진단합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* 1. 설정 패널 (좌측) */}
        <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm space-y-6 h-fit">
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
            
            {searchResults.length > 0 && !selectedProduct && (
              <ul className="mt-2 border border-neutral-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
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

            {selectedProduct && (
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg flex justify-between items-center">
                <div>
                  <div className="text-xs text-blue-600 font-bold">선택됨</div>
                  <div className="text-sm font-bold text-neutral-800">{selectedProduct.MATNR_T}</div>
                  <div className="text-[10px] text-neutral-500 mt-1">
                    기준: {selectedProduct.MEINS} | 박스입수: {selectedProduct.UMREZ_BOX}
                  </div>
                </div>
                <button onClick={() => setSelectedProduct(null)} className="text-xs text-neutral-400 underline">변경</button>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-bold text-neutral-700 block mb-2">2. 유효 재고 기준</label>
            <div className="flex items-center gap-2 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <Calendar size={16} className="text-neutral-500"/>
              <span className="text-sm text-neutral-600">잔여 유통기한</span>
              <input 
                type="number" 
                value={minShelfLife}
                onChange={e => setMinShelfLife(Number(e.target.value))}
                className="w-16 p-1 text-center font-bold border border-neutral-300 rounded"
              />
              <span className="text-sm text-neutral-600">일 이상</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-bold text-neutral-700 block mb-2">3. 추가 요청 정보</label>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-neutral-500 block mb-1">납품 희망일</span>
                <input 
                  type="date" 
                  value={targetDate}
                  onChange={e => setTargetDate(e.target.value)}
                  className="w-full p-2 text-sm border border-neutral-300 rounded-lg"
                />
              </div>
              <div>
                <span className="text-xs text-neutral-500 block mb-1">
                  필요 수량 ({unitMode === 'BOX' ? 'BOX' : 'EA/KG'})
                </span>
                <input 
                  type="number" 
                  value={unitMode === 'BOX' ? baseQty / (selectedProduct?.UMREZ_BOX || 1) : baseQty}
                  onChange={handleQtyChange}
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
              
              {/* (1) 판정 배너 */}
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
                      ? `요청하신 날짜(${targetDate})에 기수요를 제외하고도 공급 가능합니다.` 
                      : `기수요 차감 후, ${result.shortageDate}에 ${formatQty(result.shortageQty)}${unitMode === 'BOX' ? 'BOX' : 'EA'}가 부족합니다.`}
                  </p>
                </div>
              </div>

              {/* (2) 요약 카드 (기수요 추가됨) */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-white border border-neutral-200 rounded-xl">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><Package size={14}/> 현재 유효 재고</div>
                  <div className="text-xl font-bold">{formatQty(result.currentUsableStock)}</div>
                  <div className="text-xs text-neutral-400 font-normal">{unitMode==='BOX'?'BOX':'EA'} (잔여 {minShelfLife}일↑)</div>
                </div>
                <div className="p-4 bg-white border border-neutral-200 rounded-xl">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><Truck size={14}/> 미래 입고 예정</div>
                  <div className="text-xl font-bold text-blue-600">+{formatQty(result.totalProduction)}</div>
                  <div className="text-xs text-neutral-400">생산 계획 합계</div>
                </div>
                {/* 🚨 기수요 카드 추가 */}
                <div className="p-4 bg-white border border-neutral-200 rounded-xl">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><ClipboardList size={14}/> 기수요 (Existing)</div>
                  <div className="text-xl font-bold text-orange-600">-{formatQty(result.committedDemand || 0)}</div>
                  <div className="text-xs text-neutral-400">이미 잡힌 주문</div>
                </div>
                <div className="p-4 bg-white border border-neutral-200 rounded-xl bg-blue-50/50 border-blue-100">
                  <div className="text-xs text-neutral-500 flex items-center gap-1 mb-1"><ShoppingCart size={14}/> 신규 요청</div>
                  <div className="text-xl font-bold text-neutral-900">-{formatQty(baseQty)}</div>
                  <div className="text-xs text-neutral-400">{targetDate} 출고</div>
                </div>
              </div>

              {/* (3) 상세 분석 영역: 차트 + 수불 리스트 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* 왼쪽: 재고 추이 차트 */}
                <div className="md:col-span-2 bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
                  <h3 className="font-bold text-lg mb-4 text-neutral-800 flex items-center gap-2">
                    📅 예상 재고 추이 (Inventory Balance)
                  </h3>
                  <div className="h-[300px] w-full">
                    <InventoryBalanceChart timeline={result.timeline} />
                  </div>
                  <div className="text-center mt-4 text-xs text-neutral-500">
                    그래프가 <span className="text-red-500 font-bold">점선 아래(음수)</span>로 내려가면 결품입니다.
                  </div>
                </div>

                {/* 오른쪽: 상세 수불 내역 (Transaction Log) */}
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm flex flex-col overflow-hidden h-[400px]">
                  <div className="p-4 border-b border-neutral-100 bg-neutral-50">
                    <h3 className="font-bold text-neutral-800 text-sm flex items-center gap-2">
                      <Truck size={16} className="text-blue-600"/> 상세 수불 내역
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-1">
                      생산(+) 및 기수요/신규요청(-) 반영 내역
                    </p>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-2">
                    {/* timeline에서 STOCK(기초재고) 제외하고 생산/주문/신규요청만 필터링 */}
                    {result.timeline.filter((e: any) => e.type !== 'STOCK').length > 0 ? (
                      <div className="space-y-2">
                        {result.timeline
                          .filter((e: any) => e.type !== 'STOCK')
                          .map((e: any, idx: number) => {
                            // 스타일 분기
                            let boxClass = "";
                            let label = "";
                            let valueClass = "";
                            let sign = "";

                            if (e.type === 'PRODUCTION') {
                                boxClass = "bg-blue-50 border-blue-100";
                                label = "생산 입고";
                                valueClass = "text-blue-700";
                                sign = "+";
                            } else if (e.type === 'EXISTING_ORDER') {
                                boxClass = "bg-orange-50 border-orange-100";
                                label = "기존 주문";
                                valueClass = "text-orange-700";
                                sign = ""; // 음수값으로 들어옴
                            } else if (e.type === 'NEW_REQUEST') {
                                boxClass = "bg-green-50 border-green-100 border-l-4 border-l-green-500";
                                label = "신규 요청 (This)";
                                valueClass = "text-green-700 font-bold";
                                sign = ""; // 음수값
                            }

                            return (
                              <div key={idx} className={`flex justify-between items-center p-3 border rounded-lg ${boxClass}`}>
                                <div className="flex flex-col">
                                  <span className="text-xs font-bold text-neutral-800">{e.date}</span>
                                  <span className="text-[10px] text-neutral-500">{label}</span>
                                </div>
                                <div className="text-right">
                                  <span className={`text-sm font-bold ${valueClass}`}>
                                    {sign}{formatQty(e.qty)}
                                  </span>
                                  <div className="text-[10px] text-neutral-400">
                                    잔고: {formatQty(e.balance)}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        }
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-neutral-400 gap-2">
                        <Calendar size={24} className="opacity-20"/>
                        <span className="text-xs">변동 내역이 없습니다.</span>
                      </div>
                    )}
                  </div>
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