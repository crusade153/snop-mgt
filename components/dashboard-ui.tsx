'use client'

import { useDashboardData } from '@/hooks/use-dashboard'; 
import { Filter, HelpCircle, AlertTriangle, TrendingUp, CalendarClock, Truck, CheckCircle } from 'lucide-react';
import { DashboardAnalysis, IntegratedItem } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store'; 
import { DailyAlertItem } from '@/actions/daily-actions'; // ✅ 타입 import

interface Props {
  initialData: DashboardAnalysis | null;
  dailyAlerts?: DailyAlertItem[]; // ✅ Props 추가
}

export default function DashboardClientUserInterface({ initialData, dailyAlerts = [] }: Props) {
  const { data, isLoading } = useDashboardData(initialData || undefined);
  const { unitMode } = useUiStore(); 

  if (isLoading) return (
    <div className="flex items-center justify-center h-[calc(100vh-100px)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-primary-brand rounded-full animate-spin"></div>
        <span className="text-neutral-500 text-sm">데이터 분석 중...</span>
      </div>
    </div>
  );
  
  if (!data) return <div className="p-10 text-center text-status-error">데이터 로드 실패</div>;

  const formatQty = (val: number, conversion: number, baseUnit: string) => {
    if (unitMode === 'BOX') {
      const factor = conversion > 0 ? conversion : 1;
      return { 
        value: (val / factor).toLocaleString(undefined, { maximumFractionDigits: 1 }), 
        unit: 'BOX' 
      };
    }
    return { value: val.toLocaleString(), unit: baseUnit };
  };

  // 🚨 일일 관리 카드 렌더링 함수
  const renderAlertCard = (item: DailyAlertItem) => {
    let icon, bgColor, borderColor, titleColor, category;
    switch (item.type) {
      case 'SPIKE':
        icon = <TrendingUp size={18} className="text-[#E65100]" />;
        bgColor = 'bg-orange-50';
        borderColor = 'border-orange-200';
        titleColor = 'text-orange-800';
        category = '수요 급변';
        break;
      case 'SHORTAGE':
        icon = <AlertTriangle size={18} className="text-[#C62828]" />;
        bgColor = 'bg-red-50';
        borderColor = 'border-red-200';
        titleColor = 'text-red-800';
        category = '결품 예상';
        break;
      case 'FRESHNESS':
        icon = <CalendarClock size={18} className="text-[#C62828]" />;
        bgColor = 'bg-red-50';
        borderColor = 'border-red-200';
        titleColor = 'text-red-800';
        category = '유통기한 임박';
        break;
      case 'MISS':
        icon = <Truck size={18} className="text-yellow-600" />;
        bgColor = 'bg-yellow-50';
        borderColor = 'border-yellow-200';
        titleColor = 'text-yellow-800';
        category = '미납 발생';
        break;
    }

    return (
      <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg border ${bgColor} ${borderColor} shadow-sm min-w-[300px] max-w-[400px]`}>
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1">
          <div className="flex justify-between items-start mb-1">
            <span className={`text-[11px] font-bold ${titleColor}`}>{category}</span>
            <span className={`text-sm font-bold ${titleColor}`}>{item.value}</span>
          </div>
          <div className="font-bold text-neutral-900 text-sm mb-1">{item.productName}</div>
          <p className="text-[11px] text-neutral-700 leading-tight mb-2">{item.message}</p>
          <div className="flex items-center gap-1 text-[10px] text-blue-700 font-bold bg-white/50 px-2 py-1 rounded">
            <CheckCircle size={10} /> {item.action}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4 pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">종합 현황 Dashboard</h1>
          <p className="text-[12px] text-neutral-700 mt-1">전사 S&OP 핵심 지표 모니터링</p>
        </div>
      </div>

      {/* 🚨 2. Daily Morning Watch Section (최상단 배치) */}
      {dailyAlerts.length > 0 && (
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#E53935]"></span>
            </span>
            <h2 className="text-sm font-bold text-[#E53935]">Daily Morning Watch (오늘의 관리 포인트)</h2>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-2">
            {dailyAlerts.map(item => renderAlertCard(item))}
          </div>
        </div>
      )}

      {/* 3. KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard title="제품 매출" value={Math.round(data.kpis.productSales / 1000000)} unit="백만원" type="blue" />
        <KpiCard title="상품 매출" value={Math.round(data.kpis.merchandiseSales / 1000000)} unit="백만원" type="neutral" />
        <KpiCard 
          title="미납 손실액" 
          value={Math.round(data.kpis.totalUnfulfilledValue / 1000000)} 
          unit="백만원" 
          type="brand" 
          alert={true} 
          tooltip="미납수량 × 정상단가 합계" 
        />
        <KpiCard 
          title="긴급 납품" 
          value={data.kpis.criticalDeliveryCount} 
          unit="건" 
          type="warning" 
          tooltip="납품요청일로부터 7일 이상 지연된 품목 수"
        />
        <KpiCard title="재고 폐기/임박" value={data.stockHealth.disposed + data.stockHealth.imminent} unit="개 제품" type="warning" />
      </div>

      {/* ... 나머지 차트 및 테이블 코드 (변경 없음) ... */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RankingCard title="🏆 Top 5 베스트 제품 (매출)" data={data.salesAnalysis.topProducts} />
        <RankingCard title="🏢 Top 5 거래처 (매출)" data={data.salesAnalysis.topCustomers} />
        
        <div className="bg-white rounded p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[16px] font-semibold text-neutral-900">📦 재고 건전성</h2>
          </div>
          <div className="space-y-5">
            <StockBar label="양호 (Healthy)" value={data.stockHealth.healthy} total={data.integratedArray.length} color="bg-[#42A5F5]" />
            <StockBar label="긴급 (Critical)" value={data.stockHealth.critical} total={data.integratedArray.length} color="bg-[#FBC02D]" />
            <StockBar label="임박 (Imminent)" value={data.stockHealth.imminent} total={data.integratedArray.length} color="bg-[#F57C00]" />
            <StockBar label="폐기 (Disposed)" value={data.stockHealth.disposed} total={data.integratedArray.length} color="bg-[#E53935]" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden mt-2">
        <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-white">
          <h2 className="text-[16px] font-semibold text-neutral-900">📋 통합 S&OP 상세 현황 (Top 20 주요 관리 항목)</h2>
          <button className="text-xs text-neutral-500 flex items-center gap-1 hover:text-primary-blue">
            <Filter size={12} /> 필터
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-[#FAFAFA]">
              <tr>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">코드</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700">제품명</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">미납금액(백만원)</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right">
                  재고 ({unitMode === 'BOX' ? 'BOX' : '기준'})
                </th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center">상태</th>
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-right group cursor-help">
                  <div className="flex items-center justify-end gap-1">
                    일평균 판매량
                    <HelpCircle size={12} className="text-neutral-400" />
                    <div className="absolute hidden group-hover:block right-4 mt-8 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50 whitespace-nowrap font-normal">
                      최근 60일 실적수량 ÷ 60
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.integratedArray
                .sort((a: IntegratedItem, b: IntegratedItem) => b.totalUnfulfilledValue - a.totalUnfulfilledValue)
                .slice(0, 20)
                .map((item: IntegratedItem) => {
                  const displayStock = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                  const displayAds = formatQty(item.inventory.ads, item.umrezBox, item.unit);

                  return (
                    <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[48px]">
                      <td className="px-4 py-3 text-center text-neutral-500 font-mono text-xs">{item.code}</td>
                      <td className="px-4 py-3 text-neutral-900">{item.name}</td>
                      <td className="px-4 py-3 text-right font-bold text-primary-brand">
                        {Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-700">
                        {displayStock.value} 
                        <span className="text-[10px] text-neutral-400 ml-1">{displayStock.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.totalUnfulfilledQty > 0 ? (
                          <span className="px-2 py-1 rounded text-[11px] font-bold bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]">
                            미납 관리
                          </span>
                        ) : (
                          <StatusBadge status={item.inventory.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-neutral-800">
                        {displayAds.value} <span className="text-[10px] text-neutral-400 font-normal">{displayAds.unit}</span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, unit, type, tooltip }: any) {
  const styles: any = {
    brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]' },
    blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]' },
    warning: { bg: 'bg-[#FFF3E0]', text: 'text-[#EF6C00]', label: 'text-[#FFA726]' },
    neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]', label: 'text-[#757575]' },
  };
  const currentStyle = styles[type] || styles.neutral;
  return (
    <div className={`p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 ${currentStyle.bg} transition hover:-translate-y-1 relative group`}>
      <div className={`text-[12px] font-medium mb-1 ${currentStyle.label} flex items-center gap-1`}>
        {title}
        {tooltip && <HelpCircle size={12} className="cursor-help" />}
      </div>
      <div className={`text-[24px] font-bold ${currentStyle.text}`}>
        {value.toLocaleString()} 
        <span className="text-[12px] font-normal ml-1 opacity-70">{unit}</span>
      </div>
      {tooltip && (
        <div className="absolute hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-10">
          {tooltip}
        </div>
      )}
    </div>
  );
}

function RankingCard({ title, data }: any) {
  const topList = (data || []).slice(0, 5);
  return (
    <div className="bg-white rounded p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
      <div className="flex justify-between items-center mb-4 pb-2 border-b border-neutral-100">
        <h2 className="text-[16px] font-semibold text-neutral-900">{title}</h2>
      </div>
      <ul className="space-y-3">
        {topList.map((item: any, idx: number) => (
          <li key={idx} className="flex items-center text-sm gap-3">
            <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${idx < 3 ? 'bg-primary-blue text-white' : 'bg-neutral-100 text-neutral-500'}`}>
              {idx + 1}
            </span>
            <span className="text-neutral-700 truncate flex-1 min-w-0" title={item.name}>
              {item.name}
            </span>
            <span className="font-bold text-neutral-900 shrink-0 whitespace-nowrap">
                {Math.round(item.value / 1000000).toLocaleString()} <span className="text-[10px] font-normal text-neutral-400">백만</span>
            </span>
          </li>
        ))}
        {topList.length === 0 && <li className="text-center text-neutral-400 text-xs py-4">데이터 없음</li>}
      </ul>
    </div>
  );
}

function StockBar({ label, value, total, color }: any) {
  const percent = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="font-medium text-neutral-700">{label}</span>
        <span className="font-bold text-neutral-900">{value}개 제품</span>
      </div>
      <div className="w-full bg-neutral-100 rounded-sm h-2 overflow-hidden">
        <div className={`h-full rounded-sm ${color} transition-all duration-1000 ease-out`} style={{ width: `${percent}%` }}></div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string, text: string, label: string }> = {
    healthy: { bg: '#E3F2FD', text: '#1E88E5', label: '양호' },
    critical: { bg: '#FFF8E1', text: '#F57F17', label: '긴급' }, 
    imminent: { bg: '#FFF3E0', text: '#E65100', label: '임박' },
    disposed: { bg: '#FFEBEE', text: '#E53935', label: '폐기' },
  };
  const current = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (
    <span className="px-2 py-1 rounded text-[11px] font-bold" style={{ backgroundColor: current.bg, color: current.text }}>
      {current.label}
    </span>
  );
}