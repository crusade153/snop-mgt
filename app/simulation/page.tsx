'use client'

import { useState } from 'react';
import { runInventorySimulation } from '@/lib/simulation-engine';
import { 
  Play, RefreshCw, Box, ShoppingCart, Factory, 
  CheckCircle, AlertTriangle, XCircle 
} from 'lucide-react';

export default function SimulationPage() {
  // 사용자가 입력할 가상의 데이터 (실제로는 API 연동 가능)
  // 예시: 잘 팔리는 제품 하나를 기본값으로 세팅
  const [input, setInput] = useState({
    productName: 'The미식 백미밥 210g',
    currentStock: 5000,
    productionPlan: 3000,
    avgMonthlySales: 4500, // 평소 이정도 팔림
    salesIncreasePct: 0    // 판매량 증가율 (슬라이더 조절)
  });

  const [result, setResult] = useState<any>(null);

  const handleRun = () => {
    // 엔진 실행 (서버 액션 없이 클라이언트에서 즉시 계산 - 가벼운 로직이므로)
    const res = runInventorySimulation(input);
    setResult(res);
  };

  const handleReset = () => {
    setInput({ ...input, salesIncreasePct: 0 });
    setResult(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          ⚖️ 재고 감당 능력 시뮬레이션 (Inventory Feasibility)
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          "특정 제품의 판매량을 늘렸을 때, 현재 재고와 생산 계획으로 감당 가능한가?"를 진단합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* 1. 입력 패널 */}
        <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm space-y-6 h-fit">
          <h3 className="font-bold text-lg text-neutral-800 mb-4">📝 시나리오 설정</h3>
          
          {/* 제품 정보 (데모용 입력 필드) */}
          <div className="space-y-4 p-4 bg-neutral-50 rounded-lg border border-neutral-100">
            <div>
              <label className="text-xs font-bold text-neutral-500">대상 품목</label>
              <input type="text" value={input.productName} onChange={e => setInput({...input, productName: e.target.value})} className="w-full mt-1 p-2 border rounded bg-white text-sm font-bold" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold text-neutral-500">현재 재고 (EA)</label>
                <input type="number" value={input.currentStock} onChange={e => setInput({...input, currentStock: Number(e.target.value)})} className="w-full mt-1 p-2 border rounded bg-white text-sm" />
              </div>
              <div>
                <label className="text-xs font-bold text-neutral-500">생산 예정 (EA)</label>
                <input type="number" value={input.productionPlan} onChange={e => setInput({...input, productionPlan: Number(e.target.value)})} className="w-full mt-1 p-2 border rounded bg-white text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-neutral-500">평소 월 판매량 (EA)</label>
              <input type="number" value={input.avgMonthlySales} onChange={e => setInput({...input, avgMonthlySales: Number(e.target.value)})} className="w-full mt-1 p-2 border rounded bg-white text-sm" />
            </div>
          </div>

          {/* 핵심 슬라이더 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-neutral-700">📢 판매량 증가 목표</span>
              <span className="text-2xl font-bold text-primary-blue">+{input.salesIncreasePct}%</span>
            </div>
            <input 
              type="range" min="0" max="200" step="10"
              value={input.salesIncreasePct}
              onChange={(e) => setInput({...input, salesIncreasePct: Number(e.target.value)})}
              className="w-full h-3 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-primary-blue"
            />
            <div className="flex justify-between text-xs text-neutral-400 mt-1">
              <span>현재 유지 (0%)</span>
              <span>3배 판매 (200%)</span>
            </div>
          </div>

          <button onClick={handleRun} className="w-full bg-neutral-900 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 transition-all">
            <Play size={16} /> 시뮬레이션 실행
          </button>
        </div>

        {/* 2. 결과 패널 */}
        <div className="lg:col-span-2">
          {result ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              
              {/* 인사이트 배너 */}
              <div className={`p-6 rounded-xl border-l-4 shadow-sm flex items-start gap-4 ${
                result.status === 'SAFE' ? 'bg-green-50 border-green-500 text-green-800' :
                result.status === 'WARNING' ? 'bg-orange-50 border-orange-500 text-orange-800' :
                'bg-red-50 border-red-500 text-red-800'
              }`}>
                {result.status === 'SAFE' ? <CheckCircle size={28} /> :
                 result.status === 'WARNING' ? <AlertTriangle size={28} /> :
                 <XCircle size={28} />}
                <div>
                  <h3 className="font-bold text-lg mb-1">
                    {result.status === 'SAFE' ? '공급 안정 (Safe)' :
                     result.status === 'WARNING' ? '재고 주의 (Warning)' : '결품 위험 (Danger)'}
                  </h3>
                  <p className="text-sm font-medium opacity-90">{result.insight}</p>
                </div>
              </div>

              {/* 시각화: 막대 비교 */}
              <div className="bg-white p-8 rounded-xl border border-neutral-200 shadow-sm">
                <h3 className="font-bold text-neutral-800 mb-8 text-center">공급 vs 수요 밸런스 확인</h3>
                
                <div className="flex items-end justify-center gap-16 h-[200px] pb-6 border-b border-neutral-100">
                  
                  {/* 공급 기둥 */}
                  <div className="flex flex-col items-center gap-2 group relative">
                    <div className="text-sm font-bold text-blue-600 mb-1">{result.scenario.totalSupply.toLocaleString()}</div>
                    <div className="w-24 bg-blue-100 rounded-t-lg relative overflow-hidden flex flex-col justify-end" style={{ height: '180px' }}>
                      <div className="w-full bg-blue-500 transition-all duration-1000" style={{ height: `${Math.min((result.scenario.totalSupply / Math.max(result.scenario.totalSupply, result.scenario.targetDemand)) * 100, 100)}%` }}></div>
                      {/* 구성요소 표시 */}
                      <div className="absolute bottom-0 w-full text-[10px] text-white text-center pb-1">
                        생산 {input.productionPlan}
                      </div>
                    </div>
                    <div className="font-bold text-neutral-700 flex items-center gap-1"><Factory size={14}/> 가용 공급량</div>
                  </div>

                  {/* VS */}
                  <div className="text-neutral-300 font-bold text-xl italic">VS</div>

                  {/* 수요 기둥 */}
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-sm font-bold text-red-600 mb-1">{result.scenario.targetDemand.toLocaleString()}</div>
                    <div className="w-24 bg-red-100 rounded-t-lg relative overflow-hidden flex flex-col justify-end" style={{ height: '180px' }}>
                      <div className="w-full bg-red-500 transition-all duration-1000" style={{ height: `${Math.min((result.scenario.targetDemand / Math.max(result.scenario.totalSupply, result.scenario.targetDemand)) * 100, 100)}%` }}></div>
                    </div>
                    <div className="font-bold text-neutral-700 flex items-center gap-1"><ShoppingCart size={14}/> 예상 수요량</div>
                  </div>
                </div>

                {/* 상세 수치 */}
                <div className="flex justify-between mt-6 px-10 text-sm">
                  <div className="text-center">
                    <div className="text-neutral-500">현재 재고</div>
                    <div className="font-bold text-lg">{input.currentStock.toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-neutral-500">추가 생산</div>
                    <div className="font-bold text-lg text-blue-600">+{input.productionPlan.toLocaleString()}</div>
                  </div>
                  <div className="text-center border-l border-neutral-200 pl-10">
                    <div className="text-neutral-500">과부족 수량</div>
                    <div className={`font-bold text-lg ${result.scenario.gap >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {result.scenario.gap >= 0 ? '+' : ''}{result.scenario.gap.toLocaleString()}
                    </div>
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
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm">
                <Play size={32} className="text-neutral-300 ml-1" />
              </div>
              <p>조건을 설정하고 <strong>시뮬레이션 실행</strong>을 눌러주세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}