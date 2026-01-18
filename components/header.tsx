'use client';

import { Bell, User, Settings, Calendar, RefreshCw } from 'lucide-react';
import { useDateStore } from '@/store/date-store';
import { useQueryClient } from '@tanstack/react-query';

export default function Header() {
  const { startDate, endDate, setRange } = useDateStore();
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    // 버튼 클릭 시 대시보드 관련 모든 쿼리 갱신 (강제 재조회)
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <header 
      // left-[240px]로 사이드바 너비만큼 띄움
      className="fixed top-0 right-0 left-[240px] h-[60px] z-40 flex items-center justify-between px-6 bg-white border-b border-neutral-200"
    >
      {/* 왼쪽: 페이지 타이틀 */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-neutral-900">Biz-Control Tower</h2>
      </div>

      {/* 가운데: [NEW] 통합 날짜 필터 & 조회 버튼 */}
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

      {/* 오른쪽: 유저 액션 */}
      <div className="flex items-center gap-4">
        <button className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 transition-colors" title="알림">
          <Bell size={20} />
        </button>
        <button className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 transition-colors" title="설정">
          <Settings size={20} />
        </button>
        
        {/* 구분선 */}
        <div className="h-4 w-[1px] bg-neutral-200"></div>

        {/* 로그인 버튼 */}
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-neutral-50 transition-colors border border-transparent hover:border-neutral-200">
          <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600">
            <User size={16} />
          </div>
          <span className="text-sm font-medium text-neutral-700">로그인</span>
        </button>
      </div>
    </header>
  );
}