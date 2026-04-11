'use client';

import { usePathname } from 'next/navigation';
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 로그인 페이지나 승인 대기 페이지에서는 헤더/사이드바를 숨김
  const isFullScreenPage = pathname === '/login' || pathname === '/unauthorized';

  if (isFullScreenPage) {
    return <main className="w-full h-screen">{children}</main>;
  }

  return (
    <>
      <Sidebar />
      <Header />
      <main className="min-h-screen pt-[60px] lg:ml-[240px] px-5 py-5">
        {children}
      </main>
    </>
  );
}