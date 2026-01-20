'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, Truck, ClipboardList, FileText, 
  Package, Factory, ChevronRight,
  Boxes, 
  BrainCircuit, 
  LineChart 
} from 'lucide-react';

const menuItems = [
  { name: '종합 현황', href: '/dashboard', icon: LayoutDashboard },
  { name: '납품 현황', href: '/fulfillment', icon: Truck },
  { name: '미납 리스트', href: '/delivery', icon: ClipboardList },
  { name: '미납 상세', href: '/unfulfilled-detail', icon: FileText },
  { name: '재고 현황', href: '/stock', icon: Boxes },
  { name: '재고 분석', href: '/inventory', icon: Package },
  { name: '생산 분석', href: '/production', icon: Factory },
  { name: '수요 예측', href: '/forecast', icon: BrainCircuit },
  { name: '시뮬레이션', href: '/simulation', icon: LineChart },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-50 flex flex-col w-[240px] bg-[#FAFAFA] border-r border-neutral-200">
      {/* Brand Identity */}
      <div className="h-[60px] flex items-center px-6 border-b border-neutral-200 bg-white">
        {/* 🚨 [수정] Link 컴포넌트로 감싸서 클릭 시 홈('/')으로 이동 */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 rounded-full bg-primary-brand flex items-center justify-center text-white font-bold text-xs">
            Harim
          </div>
          <div>
            <div className="text-sm font-bold text-neutral-900 leading-tight">하림</div>
            <div className="text-[10px] text-neutral-500 leading-tight">하림산업</div>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-bold text-neutral-500 uppercase tracking-wider">Menu</div>
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`group flex items-center justify-between px-3 py-2.5 rounded text-sm font-medium transition-all ${isActive ? 'bg-[#E3F2FD] text-primary-blue border-l-[3px] border-primary-blue' : 'text-neutral-700 hover:bg-neutral-200 border-l-[3px] border-transparent'}`}>
              <div className="flex items-center gap-3">
                <Icon size={18} className={isActive ? 'text-primary-blue' : 'text-neutral-500 group-hover:text-neutral-900'} />
                <span>{item.name}</span>
              </div>
              {isActive && <ChevronRight size={14} className="text-primary-blue" />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-neutral-200 bg-neutral-50">
        <div className="text-[10px] text-neutral-500 text-center">© 2026 Powered by Kdyu.<br/>All rights reserved.</div>
      </div>
    </aside>
  );
}