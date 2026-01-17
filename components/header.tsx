'use client';

import { Bell, User, Settings } from 'lucide-react';

export default function Header() {
  return (
    <header 
      // left-[240px]로 사이드바 너비만큼 띄움
      className="fixed top-0 right-0 left-[240px] h-[60px] z-40 flex items-center justify-between px-6 bg-white border-b border-neutral-200"
    >
      {/* 왼쪽: 페이지 타이틀 (추후 동적으로 변경 가능) */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-neutral-900">Biz-Control Tower</h2>
      </div>

      {/* 오른쪽: 유저 액션 (심플하게 정리) */}
      <div className="flex items-center gap-4">
        <button className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 transition-colors" title="알림">
          <Bell size={20} />
        </button>
        <button className="p-2 rounded-full hover:bg-neutral-50 text-neutral-500 transition-colors" title="설정">
          <Settings size={20} />
        </button>
        
        {/* 구분선 */}
        <div className="h-4 w-[1px] bg-neutral-200"></div>

        {/* 로그인 버튼 (추후 Auth 연동 시 사용자 정보로 교체) */}
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