'use client'

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useDashboardData } from '@/hooks/use-dashboard';
import { Filter, HelpCircle, Star, TrendingUp, TrendingDown } from 'lucide-react';
import { DashboardAnalysis, IntegratedItem } from '@/types/analysis';
import { useUiStore } from '@/store/ui-store';
import { useFavorites } from '@/hooks/use-favorites';
import { getKpiTrend } from '@/actions/dashboard-actions';
import { useQuery } from '@tanstack/react-query';

interface Props {
  initialData: DashboardAnalysis | null;
}

export default function DashboardClientUserInterface({ initialData }: Props) {
  const { data, isLoading } = useDashboardData(initialData || undefined);
  const { unitMode, favoritesOnly, setFavoritesOnly } = useUiStore();
  const { favorites, isFavorite } = useFavorites();

  const { data: trendData } = useQuery({
    queryKey: ['kpi-trend'],
    queryFn: async () => {
      const res = await getKpiTrend();
      return res.success ? res.data : null;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  }); 

  if (isLoading) return (
    <div className="flex items-center justify-center h-[calc(100vh-100px)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-primary-brand rounded-full animate-spin"></div>
        <span className="text-neutral-500 text-sm">데이터 분석 중...</span>
      </div>
    </div>
  );

  if (!data) return <div className="p-10 text-center text-status-error">데이터 로드 실패</div>;

  // 즐겨찾기 필터 적용 파생 KPI
  const favItems = favoritesOnly
    ? data.integratedArray.filter((item: IntegratedItem) => isFavorite(item.code))
    : null;

  const displayKpis = favItems
    ? {
        productSales: favItems.reduce((s: number, i: IntegratedItem) => s + i.totalSalesAmount, 0),
        merchandiseSales: data.kpis.merchandiseSales,
        totalUnfulfilledValue: favItems.reduce((s: number, i: IntegratedItem) => s + i.totalUnfulfilledValue, 0),
        criticalDeliveryCount: favItems.filter((i: IntegratedItem) =>
          i.unfulfilledOrders.some((o) => o.daysDelayed >= 7)
        ).length,
      }
    : data.kpis;

  const displayStockHealth = favItems
    ? {
        healthy: favItems.filter((i: IntegratedItem) => i.inventory.status === 'healthy').length,
        critical: favItems.filter((i: IntegratedItem) => i.inventory.status === 'critical').length,
        imminent: favItems.filter((i: IntegratedItem) => i.inventory.status === 'imminent').length,
        disposed: favItems.filter((i: IntegratedItem) => i.inventory.status === 'disposed').length,
        no_expiry: favItems.filter((i: IntegratedItem) => i.inventory.status === 'no_expiry').length,
      }
    : data.stockHealth;

  const displayTopProducts = favItems
    ? [...favItems]
        .sort((a: IntegratedItem, b: IntegratedItem) => b.totalSalesAmount - a.totalSalesAmount)
        .slice(0, 5)
        .map((i: IntegratedItem) => ({ name: i.name, value: i.totalSalesAmount }))
    : data.salesAnalysis.topProducts;

  const totalForStockBar = favItems ? favItems.length : data.integratedArray.length;

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

  return (
    <div className="space-y-6">
      {/* 1. Page Header */}
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-[20px] font-bold text-neutral-900">종합 현황 Dashboard</h1>
        <p className="text-[12px] text-neutral-700 mt-1">
          전사 S&OP 핵심 지표 모니터링
          {favoritesOnly && <span className="ml-2 text-yellow-600 font-bold">— 관심제품 보기 중</span>}
        </p>
      </div>

      {/* 2. KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <KpiCard
          title={favoritesOnly ? "즐겨찾기 납품 매출" : "납품 매출"}
          value={Math.round(displayKpis.productSales / 1000000)}
          unit="백만원"
          type="blue"
          sparkline={favoritesOnly ? undefined : trendData?.sparkline}
          changeRate={favoritesOnly ? undefined : trendData?.changeRate}
        />
        <KpiCard title="상품 매출" value={Math.round(displayKpis.merchandiseSales / 1000000)} unit="백만원" type="neutral" />
        <KpiCard
          title={favoritesOnly ? "즐겨찾기 미납 손실" : "미납 손실액"}
          value={Math.round(displayKpis.totalUnfulfilledValue / 1000000)}
          unit="백만원"
          type="brand"
          alert={true}
          tooltip="미납수량 × 정상단가 합계"
        />
        <KpiCard
          title={favoritesOnly ? "즐겨찾기 긴급 납품" : "긴급 납품"}
          value={displayKpis.criticalDeliveryCount}
          unit="건"
          type="warning"
          tooltip="납품요청일로부터 7일 이상 지연된 품목 수"
        />
        <KpiCard
          title={favoritesOnly ? "즐겨찾기 폐기/임박" : "재고 폐기/임박"}
          value={displayStockHealth.disposed + displayStockHealth.imminent}
          unit="개 제품"
          type="warning"
        />
      </div>

      {/* 3. Analysis Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RankingCard
          title={favoritesOnly ? "⭐ 즐겨찾기 제품 (매출순)" : "🏆 Top 5 베스트 제품 (매출)"}
          data={displayTopProducts}
        />
        <RankingCard title="🏢 Top 5 거래처 (매출)" data={data.salesAnalysis.topCustomers} />

        {/* 재고 건전성 */}
        <div className="bg-white rounded p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[16px] font-semibold text-neutral-900">
              📦 재고 건전성
              {favoritesOnly && <span className="ml-2 text-xs text-yellow-600 font-normal">즐겨찾기 기준</span>}
            </h2>
          </div>
          <div className="space-y-5">
            <StockBar label="양호 (Healthy)" value={displayStockHealth.healthy} total={totalForStockBar} color="bg-[#42A5F5]" />
            <StockBar label="긴급 (Critical)" value={displayStockHealth.critical} total={totalForStockBar} color="bg-[#FBC02D]" />
            <StockBar label="임박 (Imminent)" value={displayStockHealth.imminent} total={totalForStockBar} color="bg-[#F57C00]" />
            <StockBar label="폐기 (Disposed)" value={displayStockHealth.disposed} total={totalForStockBar} color="bg-[#E53935]" />
          </div>
        </div>
      </div>

      {/* 4. 관심 제품 링크 */}
      {favorites.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Star size={12} className="text-yellow-400" fill="#FBBF24" />
          관심 제품 {favorites.length}개 등록됨
          <Link href="/favorites" className="text-yellow-700 hover:underline font-medium">
            관리하기 →
          </Link>
        </div>
      )}

      {/* 5. Table Section */}
      <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 overflow-hidden mt-2">
        <div className="p-5 border-b border-neutral-200 flex justify-between items-center bg-white">
          <h2 className="text-[16px] font-semibold text-neutral-900">
            📋 {favoritesOnly ? '관심 제품 현황' : '통합 S&OP 상세 현황 (Top 20 주요 관리 항목)'}
          </h2>
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
                <th className="px-4 py-3 border-b border-neutral-200 text-[13px] font-bold text-neutral-700 text-center w-[140px]">상태 및 구성</th>
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
              {(() => {
                const sorted = [...data.integratedArray].sort((a: IntegratedItem, b: IntegratedItem) => b.totalUnfulfilledValue - a.totalUnfulfilledValue);
                const displayItems = favoritesOnly
                  ? sorted.filter((item: IntegratedItem) => isFavorite(item.code))
                  : sorted.slice(0, 20);
                if (favoritesOnly && displayItems.length === 0) {
                  return (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-neutral-400 text-sm">
                        <Star size={28} className="mx-auto mb-2 text-neutral-200" />
                        관심 제품이 없습니다.{' '}
                        <Link href="/favorites" className="text-yellow-600 hover:underline font-medium">
                          관심 제품 추가하기 →
                        </Link>
                      </td>
                    </tr>
                  );
                }
                return displayItems.map((item: IntegratedItem) => {
                  
                  const displayStock = formatQty(item.inventory.totalStock, item.umrezBox, item.unit);
                  const displayAds = formatQty(item.inventory.ads, item.umrezBox, item.unit);
                  const disposedQty = formatQty(item.inventory.statusBreakdown?.disposed || 0, item.umrezBox, item.unit);

                  return (
                    <tr key={item.code} className="hover:bg-[#F9F9F9] transition-colors h-[54px]">
                      <td className="px-4 py-3 text-center text-neutral-500 font-mono text-xs">
                        <Link href={`/product/${item.code}`} className="hover:text-[#1565C0] hover:underline">
                          {item.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-neutral-900 font-medium">
                        <Link href={`/product/${item.code}`} className="hover:text-[#1565C0] hover:underline">
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-primary-brand">
                        {Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-700">
                        {displayStock.value} 
                        <span className="text-[10px] text-neutral-400 ml-1">{displayStock.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* 🚨 상태 및 구성 시각화 영역 */}
                        <div className="flex flex-col items-center gap-1.5 w-full min-w-[120px]">
                          {/* 1. 대표 상태 뱃지 */}
                          <div className="flex justify-center">
                            {item.totalUnfulfilledQty > 0 ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#FFEBEE] text-[#C62828] border border-[#FFCDD2]">
                                미납 관리
                              </span>
                            ) : (
                              <StatusBadge status={item.inventory.status} />
                            )}
                          </div>
                          
                          {/* 2. 미니 프로그레스 바 (재고 구성 비율) */}
                          {item.inventory.totalStock > 0 && (
                            <div 
                              className="flex w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden shadow-inner" 
                              title={`총 ${displayStock.value} 중 폐기 ${disposedQty.value}`}
                            >
                              <div style={{ width: `${((item.inventory.statusBreakdown?.healthy || 0) / item.inventory.totalStock) * 100}%` }} className="bg-[#42A5F5]"></div>
                              <div style={{ width: `${((item.inventory.statusBreakdown?.no_expiry || 0) / item.inventory.totalStock) * 100}%` }} className="bg-[#66BB6A]"></div>
                              <div style={{ width: `${((item.inventory.statusBreakdown?.critical || 0) / item.inventory.totalStock) * 100}%` }} className="bg-[#FBC02D]"></div>
                              <div style={{ width: `${((item.inventory.statusBreakdown?.imminent || 0) / item.inventory.totalStock) * 100}%` }} className="bg-[#F57C00]"></div>
                              <div style={{ width: `${((item.inventory.statusBreakdown?.disposed || 0) / item.inventory.totalStock) * 100}%` }} className="bg-[#E53935]"></div>
                            </div>
                          )}

                          {/* 3. 소량 폐기 재고가 존재할 경우 확 띄는 경고 뱃지 */}
                          {(item.inventory.statusBreakdown?.disposed || 0) > 0 && (
                            <div className="flex justify-center w-full">
                              <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 animate-pulse">
                                🚨 폐기 {disposedQty.value} {disposedQty.unit}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-neutral-800">
                        {displayAds.value} <span className="text-[10px] text-neutral-400 font-normal">{displayAds.unit}</span>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...data, 1);
    const step = w / (data.length - 1 || 1);
    ctx.beginPath();
    ctx.strokeStyle = '#4A90E2';
    ctx.lineWidth = 1.5;
    data.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / max) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data]);
  return <canvas ref={canvasRef} width={60} height={24} className="opacity-60" />;
}

function KpiCard({ title, value, unit, type, tooltip, sparkline, changeRate }: any) {
  const styles: any = {
    brand: { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'text-[#E53935]' },
    blue: { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'text-[#4A90E2]' },
    warning: { bg: 'bg-[#FFF3E0]', text: 'text-[#EF6C00]', label: 'text-[#FFA726]' },
    neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]', label: 'text-[#757575]' },
  };
  const currentStyle = styles[type] || styles.neutral;
  const isUp = changeRate > 0;
  return (
    <div className={`p-5 rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200 ${currentStyle.bg} transition hover:-translate-y-1 relative group`}>
      <div className={`text-[12px] font-medium mb-1 ${currentStyle.label} flex items-center gap-1`}>
        {title}
        {tooltip && <HelpCircle size={12} className="cursor-help" />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className={`text-[24px] font-bold ${currentStyle.text}`}>
          {value.toLocaleString()}
          <span className="text-[12px] font-normal ml-1 opacity-70">{unit}</span>
        </div>
        {sparkline && sparkline.length > 0 && <Sparkline data={sparkline} />}
      </div>
      {changeRate !== undefined && (
        <div className={`flex items-center gap-1 mt-1 text-[11px] font-medium ${isUp ? 'text-green-600' : 'text-red-500'}`}>
          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {isUp ? '+' : ''}{changeRate}% vs 전주
        </div>
      )}
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
    no_expiry: { bg: '#E8F5E9', text: '#43A047', label: '기한없음' }, // 기한없음 추가
    critical: { bg: '#FFF8E1', text: '#F57F17', label: '긴급' }, 
    imminent: { bg: '#FFF3E0', text: '#E65100', label: '임박' },
    disposed: { bg: '#FFEBEE', text: '#E53935', label: '폐기' },
  };
  const current = config[status] || { bg: '#F5F5F5', text: '#9E9E9E', label: status };
  return (
    <span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ backgroundColor: current.bg, color: current.text }}>
      {current.label}
    </span>
  );
}