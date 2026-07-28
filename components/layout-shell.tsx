'use client';

import { usePathname } from 'next/navigation';
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import NoticePopup from "@/components/notice-popup";
import { useUiStore } from "@/store/ui-store";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);

  // 로그인 페이지나 승인 대기 페이지에서는 헤더/사이드바를 숨김
  // (해당 페이지들은 각자 NoticePopup을 직접 렌더링한다)
  const isFullScreenPage = pathname === '/login' || pathname === '/unauthorized' || pathname === '/reset-password';

  if (isFullScreenPage) {
    return <main className="w-full h-screen">{children}</main>;
  }

  return (
    <>
      <NoticePopup />
      <Sidebar />
      <Header />
      <main className={`min-h-screen pt-[60px] px-5 py-5 transition-[margin] duration-300 ${
        sidebarCollapsed ? 'lg:ml-0' : 'lg:ml-[240px]'
      }`}>
        {children}
      </main>
    </>
  );
}
