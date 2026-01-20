'use client';

import { usePathname } from 'next/navigation';
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // 로그인 페이지나 승인 대기 페이지에서는 헤더/사이드바를 숨김
  const isFullScreenPage = pathname === '/login' || pathname === '/unauthorized';

  return (
    <>
      {!isFullScreenPage && <Sidebar />}
      {!isFullScreenPage && <Header />}
      
      <main 
        className={!isFullScreenPage ? "min-h-screen" : "w-full h-screen"}
        style={!isFullScreenPage ? { 
          marginTop: 'var(--header-height)', 
          marginLeft: 'var(--sidebar-width)',
          padding: '24px'
        } : {}}
      >
        <div className={!isFullScreenPage ? "max-w-[1600px] mx-auto" : "w-full h-full"}>
          {children}
        </div>
      </main>
    </>
  );
}