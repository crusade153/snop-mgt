'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import {
  LayoutDashboard, Truck, ClipboardList, FileText,
  Package, Factory, ChevronRight,
  Boxes, BrainCircuit, LineChart, LogOut,
  Sun, X, Star
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store';

const menuItems = [
  { name: '일일 관리 (Morning)', href: '/daily', icon: Sun },
  { name: '종합 현황', href: '/dashboard', icon: LayoutDashboard },
  { name: '관심 메뉴', href: '/favorites', icon: Star },
  { name: '납품 현황', href: '/fulfillment', icon: Truck },
  { name: '미납 리스트', href: '/delivery', icon: ClipboardList },
  { name: '미납 상세', href: '/unfulfilled-detail', icon: FileText },
  { name: '재고 현황', href: '/stock', icon: Boxes },
  { name: '재고 분석', href: '/inventory', icon: Package },
  { name: '생산 분석', href: '/production', icon: Factory },
  { name: '수요 예측', href: '/forecast', icon: BrainCircuit },
  { name: '시뮬레이션 (ATP)', href: '/simulation', icon: LineChart },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { mobileMenuOpen, setMobileMenuOpen } = useUiStore();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const handleNavClick = () => {
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <aside className="flex flex-col w-[240px] h-full bg-[#FAFAFA] border-r border-neutral-200">
      <div className="h-[60px] flex items-center justify-between px-6 border-b border-neutral-200 bg-white">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity" onClick={handleNavClick}>
          <div className="w-8 h-8 rounded-full bg-[#E53935] flex items-center justify-center text-white font-bold text-xs">
            H
          </div>
          <div>
            <div className="text-sm font-bold text-neutral-900 leading-tight">Harim</div>
            <div className="text-[10px] text-neutral-500 leading-tight">Biz-Control</div>
          </div>
        </Link>
        {/* 모바일에서만 닫기 버튼 표시 */}
        <button
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1 rounded hover:bg-neutral-100 text-neutral-500"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-bold text-neutral-500 uppercase tracking-wider">Menu</div>
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleNavClick}
              className={`group flex items-center justify-between px-3 py-2.5 rounded text-sm font-medium transition-all ${isActive ? 'bg-[#E3F2FD] text-[#1565C0] border-l-[3px] border-[#1565C0]' : 'text-neutral-700 hover:bg-neutral-200 border-l-[3px] border-transparent'}`}
            >
              <div className="flex items-center gap-3">
                <Icon size={18} className={isActive ? 'text-[#1565C0]' : 'text-neutral-500 group-hover:text-neutral-900'} />
                <span>{item.name}</span>
              </div>
              {isActive && <ChevronRight size={14} className="text-[#1565C0]" />}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-neutral-200 bg-neutral-50">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut size={18} />
          로그아웃
        </button>
        <div className="mt-4 text-[10px] text-neutral-400 text-center">
          © 2026 Harim Industry.<br/>All rights reserved.
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* 데스크톱: 고정 사이드바 */}
      <div className="hidden lg:fixed lg:left-0 lg:top-0 lg:bottom-0 lg:z-50 lg:flex">
        {sidebarContent}
      </div>

      {/* 모바일: 오버레이 사이드바 */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* 배경 딤 */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* 사이드바 패널 */}
          <div className="relative z-10 h-full">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
