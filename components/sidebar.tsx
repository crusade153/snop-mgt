'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { 
  LayoutDashboard, Truck, ClipboardList, FileText, 
  Package, Factory, ChevronRight,
  Boxes, BrainCircuit, LineChart, LogOut, CalendarClock,
  Sun // ✅ 아이콘
} from 'lucide-react';

const menuItems = [
  // 🚨 [수정] 일일 관리를 최상단으로 이동
  { name: '일일 관리 (Morning)', href: '/daily', icon: Sun },
  { name: '종합 현황', href: '/dashboard', icon: LayoutDashboard },
  { name: '납품 현황', href: '/fulfillment', icon: Truck },
  { name: '미납 리스트', href: '/delivery', icon: ClipboardList },
  { name: '미납 상세', href: '/unfulfilled-detail', icon: FileText },
  { name: '재고 현황', href: '/stock', icon: Boxes },
  { name: '재고 분석', href: '/inventory', icon: Package },
  { name: '생산 분석', href: '/production', icon: Factory },
  { name: '수요 예측', href: '/forecast', icon: BrainCircuit },
  { name: '시뮬레이션 (ATP)', href: '/simulation', icon: LineChart },
  { name: 'S&OP 플래너', href: '/snop', icon: CalendarClock },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-50 flex flex-col w-[240px] bg-[#FAFAFA] border-r border-neutral-200">
      <div className="h-[60px] flex items-center px-6 border-b border-neutral-200 bg-white">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-full bg-[#E53935] flex items-center justify-center text-white font-bold text-xs">
            H
          </div>
          <div>
            <div className="text-sm font-bold text-neutral-900 leading-tight">Harim</div>
            <div className="text-[10px] text-neutral-500 leading-tight">Biz-Control</div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-bold text-neutral-500 uppercase tracking-wider">Menu</div>
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`group flex items-center justify-between px-3 py-2.5 rounded text-sm font-medium transition-all ${isActive ? 'bg-[#E3F2FD] text-[#1565C0] border-l-[3px] border-[#1565C0]' : 'text-neutral-700 hover:bg-neutral-200 border-l-[3px] border-transparent'}`}>
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
}