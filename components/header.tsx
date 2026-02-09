'use client';

import { Calendar, RefreshCw, Box, Layers, Factory, Warehouse, Building } from 'lucide-react';
import { useDateStore } from '@/store/date-store';
import { useUiStore } from '@/store/ui-store';
import { useQueryClient } from '@tanstack/react-query';

export default function Header() {
  const { startDate, endDate, setRange } = useDateStore();
  const { unitMode, setUnitMode, inventoryViewMode, setInventoryViewMode } = useUiStore();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-analysis'] }); // 재고 분석 쿼리도 무효화
  };

  return (
    <header className="fixed top-0 right-0 left-[240px] h-[60px] z-40 flex items-center justify-between px-6 bg-white border-b border-neutral-200">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-neutral-900">Biz-Control Tower</h2>
      </div>

      <div className="flex items-center gap-4">
        
        {/* ✅ [수정] 재고 뷰 모드 컨트롤러 (플랜트 / 물류센터) */}
        <div className="flex bg-neutral-100 p-1 rounded-lg border border-neutral-200">
            <button
                onClick={() => setInventoryViewMode('PLANT')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                    inventoryViewMode === 'PLANT' ? 'bg-white shadow text-blue-700' : 'text-neutral-500 hover:text-neutral-700'
                }`}
            >
                <Factory size={14}/> 플랜트
            </button>
            <button
                onClick={() => setInventoryViewMode('LOGISTICS')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                    inventoryViewMode === 'LOGISTICS' ? 'bg-white shadow text-purple-700' : 'text-neutral-500 hover:text-neutral-700'
                }`}
            >
                <Warehouse size={14}/> 물류센터
            </button>
            <button
                onClick={() => setInventoryViewMode('ALL')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                    inventoryViewMode === 'ALL' ? 'bg-white shadow text-green-700' : 'text-neutral-500 hover:text-neutral-700'
                }`}
            >
                <Building size={14}/> 통합(All)
            </button>
        </div>

        {/* 날짜 조회 컨트롤 */}
        <div className="flex items-center gap-2 bg-neutral-50 px-3 py-1.5 rounded-lg border border-neutral-200">
          <Calendar size={14} className="text-neutral-500" />
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => setRange(e.target.value, endDate)}
            className="bg-transparent text-xs font-bold text-neutral-700 outline-none w-[90px] cursor-pointer"
          />
          <span className="text-neutral-400 text-xs">~</span>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => setRange(startDate, e.target.value)}
            className="bg-transparent text-xs font-bold text-neutral-700 outline-none w-[90px] cursor-pointer"
          />
          <div className="w-[1px] h-3 bg-neutral-300 mx-1"></div>
          <button 
            onClick={handleRefresh}
            className="flex items-center gap-1 text-xs font-bold text-primary-blue hover:text-blue-700 transition-colors active:scale-95"
          >
            <RefreshCw size={12} /> 조회
          </button>
        </div>

        {/* 단위 변환 토글 */}
        <div className="relative bg-neutral-100 p-1 rounded-lg flex w-[140px]">
          <div 
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded shadow-sm transition-all duration-300 ease-out border border-neutral-200/50 ${
              unitMode === 'BOX' ? 'left-[calc(50%+2px)]' : 'left-1'
            }`}
          />
          <button onClick={() => setUnitMode('BASE')} className={`relative z-10 flex-1 flex items-center justify-center gap-1 py-1 text-xs font-bold ${unitMode==='BASE'?'text-blue-700':'text-neutral-500'}`}><Layers size={14}/> 기준</button>
          <button onClick={() => setUnitMode('BOX')} className={`relative z-10 flex-1 flex items-center justify-center gap-1 py-1 text-xs font-bold ${unitMode==='BOX'?'text-orange-700':'text-neutral-500'}`}><Box size={14}/> BOX</button>
        </div>

      </div>
    </header>
  );
}