import Link from "next/link";
import { 
  ArrowRight, 
  BarChart3, 
  Package, 
  Truck, 
  Factory, 
  Database,
  LayoutDashboard 
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col gap-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* 1. Hero Section: 메인 타이틀 및 소개 */}
      <section className="bg-white rounded-2xl p-10 border border-neutral-200 shadow-sm relative overflow-hidden">
        <div className="relative z-10 max-w-3xl"> {/* max-w-2xl -> 3xl로 넓혀서 한 줄 여유 확보 */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFEBEE] text-[#C62828] text-xs font-bold mb-4 border border-[#FFCDD2]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E53935] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#C62828]"></span>
            </span>
            S&OP Management System (Beta)
          </div>
          <h1 className="text-4xl font-bold text-neutral-900 mb-4 leading-tight">
            Biz-Control Tower에<br />
            오신 것을 환영합니다.
          </h1>
          
          {/* 🚨 [수정] break-keep 클래스 추가 및 문맥 자연스럽게 조정 */}
          <p className="text-neutral-600 text-lg mb-8 leading-relaxed break-keep">
            본 시스템은 <strong>SAP 납품(SD), 재고(MM), 생산(PP)</strong> 데이터를 실시간으로 통합 분석하여<br className="hidden md:block"/>
            최적의 S&OP 의사결정을 지원합니다.
          </p>
          
          <div className="flex gap-3">
            <Link 
              href="/dashboard" 
              className="flex items-center gap-2 px-6 py-3 bg-[#E53935] hover:bg-[#D32F2F] text-white rounded-lg font-bold transition-all shadow-md hover:shadow-lg"
            >
              <LayoutDashboard size={20} />
              대시보드 바로가기
            </Link>
            <Link 
              href="/stock" 
              className="flex items-center gap-2 px-6 py-3 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 rounded-lg font-bold transition-all"
            >
              재고 현황 조회
            </Link>
          </div>
        </div>

        {/* 배경 장식용 아이콘 (우측) */}
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-neutral-50 to-transparent flex items-center justify-center opacity-50 pointer-events-none">
           <BarChart3 size={200} className="text-neutral-200 opacity-30" />
        </div>
      </section>

      {/* 2. Key Features: 3대 핵심 기능 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FeatureCard 
          icon={Truck}
          title="납품 요청 & 이행 (Fulfillment)"
          desc="고객 주문(Sales Order) 대비 실 납품 현황을 추적하고, 미납 원인을 분석하여 고객 신뢰도를 제고합니다."
          link="/fulfillment"
          color="blue"
        />
        <FeatureCard 
          icon={Package}
          title="재고 건전성 분석 (Inventory)"
          desc="유통기한 임박 재고, ADS(판매속도) 기반 적정 재고를 시뮬레이션하여 폐기 비용을 최소화합니다."
          link="/inventory"
          color="green"
        />
        <FeatureCard 
          icon={Factory}
          title="생산 계획 대 실적 (Production)"
          desc="생산 오더(PP)의 계획 대비 실적 달성률을 모니터링하고, 공급 차질 리스크를 사전 식별합니다."
          link="/production"
          color="orange"
        />
      </div>

      {/* 3. System Status: 데이터 연동 상태 */}
      <section className="bg-neutral-900 rounded-xl p-6 text-neutral-300 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-neutral-800 rounded-lg">
            <Database size={24} className="text-neutral-400" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">System Status</h3>
            <p className="text-sm opacity-80">BigQuery Data Warehouse Connected</p>
          </div>
        </div>
        <div className="flex gap-8 text-sm">
          <div className="flex flex-col items-end">
            <span className="text-xs uppercase tracking-wider font-bold opacity-60">Last Update</span>
            <span className="text-white font-mono">Real-time Sync</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs uppercase tracking-wider font-bold opacity-60">Database</span>
            <span className="text-[#42A5F5] font-bold">harim_sap_bi</span>
          </div>
        </div>
      </section>

    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc, link, color }: any) {
  const colors: any = {
    blue: "text-[#1565C0] bg-[#E3F2FD] border-[#BBDEFB] group-hover:border-[#1565C0]",
    green: "text-[#2E7D32] bg-[#E8F5E9] border-[#C8E6C9] group-hover:border-[#2E7D32]",
    orange: "text-[#EF6C00] bg-[#FFF3E0] border-[#FFE0B2] group-hover:border-[#EF6C00]",
  };
  const c = colors[color] || colors.blue;

  return (
    <Link href={link} className="group block h-full">
      <div className="bg-white h-full p-6 rounded-xl border border-neutral-200 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1 flex flex-col">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-colors ${c}`}>
          <Icon size={24} />
        </div>
        <h3 className="text-lg font-bold text-neutral-900 mb-2 group-hover:text-[#E53935] transition-colors">
          {title}
        </h3>
        <p className="text-sm text-neutral-600 leading-relaxed mb-6 flex-1 break-keep">
          {desc}
        </p>
        <div className="flex items-center text-sm font-bold text-neutral-400 group-hover:text-[#E53935] transition-colors">
          상세 분석 보기 <ArrowRight size={16} className="ml-1" />
        </div>
      </div>
    </Link>
  );
}