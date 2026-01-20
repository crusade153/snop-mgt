'use client';

import { Bell, User, Settings, Calendar, RefreshCw, Box, Layers } from 'lucide-react';
import { useDateStore } from '@/store/date-store';
import { useUiStore } from '@/store/ui-store';
import { useQueryClient } from '@tanstack/react-query';

export default function Header() {
  const { startDate, endDate, setRange } = useDateStore();
  const { unitMode, setUnitMode } = useUiStore(); // ✅ setUnitMode 사용
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <header className="fixed top-0 right-0 left-[240px] h-[60px] z-40 flex items-center justify-between px-6 bg-white border-b border-neutral-200">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-neutral-900">Biz-Control Tower</h2>
      </div>

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

      <div className="flex items-center gap-4">
        {/* ✅ [수정] 슬라이딩 세그먼트 컨트롤 (Radio Style Toggle) */}
        <div className="relative bg-neutral-100 p-1 rounded-lg flex w-[220px]">
          {/* 애니메이션되는 하얀 배경 (Slider) */}
          <div 
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded shadow-sm transition-all duration-300 ease-out border border-neutral-200/50 ${
              unitMode === 'BOX' ? 'left-[calc(50%+2px)]' : 'left-1'
            }`}
          />

          {/* 기준 단위 버튼 */}
          <button 
            onClick={() => setUnitMode('BASE')}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold transition-colors ${
              unitMode === 'BASE' ? 'text-blue-700' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Layers size={14} /> 기준 (EA/KG)
          </button>

          {/* 박스 단위 버튼 */}
          <button 
            onClick={() => setUnitMode('BOX')}
            className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold transition-colors ${
              unitMode === 'BOX' ? 'text-orange-700' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            <Box size={14} /> 박스 (BOX)
          </button>
        </div>

        <div className="h-4 w-[1px] bg-neutral-200"></div>

        <button className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 transition-colors"><Bell size={20} /></button>
        <button className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 transition-colors"><Settings size={20} /></button>
        <div className="h-4 w-[1px] bg-neutral-200"></div>
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-neutral-50 transition-colors border border-transparent hover:border-neutral-200">
          <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600"><User size={16} /></div>
          <span className="text-sm font-medium text-neutral-700">로그인</span>
        </button>
      </div>
    </header>
  );
}