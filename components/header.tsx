'use client';

import { Calendar, RefreshCw, Box, Layers } from 'lucide-react';
import { useDateStore } from '@/store/date-store';
import { useUiStore } from '@/store/ui-store';
import { useQueryClient } from '@tanstack/react-query';

export default function Header() {
  const { startDate, endDate, setRange } = useDateStore();
  const { unitMode, setUnitMode } = useUiStore();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <header className="fixed top-0 right-0 left-[240px] h-[60px] z-40 flex items-center justify-between px-6 bg-white border-b border-neutral-200">
      {/* 왼쪽: 타이틀 */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-neutral-900">Biz-Control Tower</h2>
      </div>

      {/* 오른쪽: 컨트롤 영역 */}
      <div className="flex items-center gap-4">
        
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
        <div className="relative bg-neutral-100 p-1 rounded-lg flex w-[220px]">
          <div 
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded shadow-sm transition-all duration-300 ease-out border border-neutral-200/50 ${
              unitMode === 'BOX' ? 'left-[calc(50%+2px)]' : 'left-1'
            }`}
          />
          <button 
            onClick={() => setUnitMode('BASE')}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold transition-colors ${
              unitMode === 'BASE' ? 'text-blue-700' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Layers size={14} /> 기준 (EA/KG)
          </button>
          <button 
            onClick={() => setUnitMode('BOX')}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold transition-colors ${
              unitMode === 'BOX' ? 'text-orange-700' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Box size={14} /> 박스 (BOX)
          </button>
        </div>

      </div>
    </header>
  );
}