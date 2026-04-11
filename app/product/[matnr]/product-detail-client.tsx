'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Package, TrendingUp, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import CanvasLineChart from '@/components/charts/canvas-line-chart';
import { useUiStore } from '@/store/ui-store';
import { ProductDetailData } from '@/actions/product-actions';

interface Props {
  data: ProductDetailData;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  healthy:   { bg: '#E3F2FD', text: '#1E88E5', label: '양호' },
  no_expiry: { bg: '#E8F5E9', text: '#43A047', label: '기한없음' },
  critical:  { bg: '#FFF8E1', text: '#F57F17', label: '긴급' },
  imminent:  { bg: '#FFF3E0', text: '#E65100', label: '임박' },
  disposed:  { bg: '#FFEBEE', text: '#E53935', label: '폐기' },
};

export default function ProductDetailClient({ data }: Props) {
  const { unitMode } = useUiStore();
  const [prodPage, setProdPage] = useState(1);
  const prodItemsPerPage = 10;

  const fmtQty = (val: number) => {
    if (unitMode === 'BOX') {
      const f = data.umrezBox > 0 ? data.umrezBox : 1;
      return { v: (val / f).toLocaleString(undefined, { maximumFractionDigits: 1 }), u: 'BOX' };
    }
    return { v: val.toLocaleString(), u: data.unit };
  };

  // 판매 추이 차트 데이터 (일별 수량)
  const sortedTrend = [...data.salesTrend].sort((a, b) => a.date.localeCompare(b.date));
  const chartLabels = sortedTrend.map((r) => {
    const d = r.date;
    return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
  });
  const chartQty = sortedTrend.map((r) => {
    const q = fmtQty(r.qty);
    return parseFloat(q.v.replace(/,/g, ''));
  });

  // 생산 페이지네이션
  const totalProdPages = Math.ceil(data.production.length / prodItemsPerPage);
  const pagedProd = data.production.slice(
    (prodPage - 1) * prodItemsPerPage,
    prodPage * prodItemsPerPage
  );

  const formatDate = (d: string) => {
    if (!d) return '-';
    const s = String(d).replace(/-/g, '');
    if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return d;
  };

  const { kpi } = data;
  const stockDisplay = fmtQty(kpi.totalStock);
  const unfulfilledDisplay = fmtQty(kpi.unfulfilledQty);

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-neutral-200">
        <Link
          href="/dashboard"
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          <ArrowLeft size={16} />
          뒤로
        </Link>
        <div className="w-px h-4 bg-neutral-300" />
        <Package size={20} className="text-[#1565C0]" />
        <div>
          <h1 className="text-[18px] font-bold text-neutral-900 leading-tight">{data.name}</h1>
          <p className="text-[11px] text-neutral-500 font-mono">{data.code}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="최근 30일 매출"
          value={`${Math.round(kpi.sales30Amount / 1000000).toLocaleString()} 백만원`}
          icon={<TrendingUp size={18} className="text-[#1565C0]" />}
          color="blue"
        />
        <KpiCard
          title={`현재 재고 (${stockDisplay.u})`}
          value={`${stockDisplay.v} ${stockDisplay.u}`}
          icon={<Package size={18} className="text-[#43A047]" />}
          color="green"
        />
        <KpiCard
          title={`미납 수량 (${unfulfilledDisplay.u})`}
          value={`${unfulfilledDisplay.v} ${unfulfilledDisplay.u}`}
          icon={<AlertTriangle size={18} className="text-[#E53935]" />}
          color={kpi.unfulfilledQty > 0 ? 'red' : 'neutral'}
          sub={kpi.unfulfilledValue > 0 ? `손실 ${Math.round(kpi.unfulfilledValue / 1000000).toLocaleString()}백만원` : undefined}
        />
      </div>

      {/* 판매 추이 차트 */}
      <div className="bg-white rounded border border-neutral-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
        <h2 className="text-[15px] font-semibold text-neutral-900 mb-4">
          최근 60일 판매 추이
          <span className="ml-2 text-[11px] font-normal text-neutral-400">단위: {unitMode === 'BOX' ? 'BOX' : data.unit}</span>
        </h2>
        {chartLabels.length > 0 ? (
          <CanvasLineChart
            historyData={chartQty}
            forecastData={[]}
            labels={chartLabels}
            height={220}
          />
        ) : (
          <div className="flex items-center justify-center h-[220px] text-neutral-400 text-sm">
            판매 데이터 없음
          </div>
        )}
      </div>

      {/* 배치별 재고 */}
      <div className="bg-white rounded border border-neutral-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
        <h2 className="text-[15px] font-semibold text-neutral-900 mb-4">배치별 재고 현황</h2>
        {data.batches.length === 0 ? (
          <div className="text-center py-8 text-neutral-400 text-sm">재고 데이터 없음</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50">
                  <th className="px-4 py-2.5 border-b border-neutral-200 text-left text-[12px] font-bold text-neutral-600">위치</th>
                  <th className="px-4 py-2.5 border-b border-neutral-200 text-right text-[12px] font-bold text-neutral-600">수량</th>
                  <th className="px-4 py-2.5 border-b border-neutral-200 text-center text-[12px] font-bold text-neutral-600">소비기한</th>
                  <th className="px-4 py-2.5 border-b border-neutral-200 text-right text-[12px] font-bold text-neutral-600">잔여일</th>
                  <th className="px-4 py-2.5 border-b border-neutral-200 text-center text-[12px] font-bold text-neutral-600">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.batches.map((b, idx) => {
                  const qtyDisplay = fmtQty(b.qty);
                  const cfg = STATUS_CONFIG[b.status] || STATUS_CONFIG.healthy;
                  return (
                    <tr key={idx} className="hover:bg-neutral-50">
                      <td className="px-4 py-2.5 text-neutral-700">{b.location || '-'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-neutral-900">
                        {qtyDisplay.v} <span className="text-[10px] text-neutral-400">{qtyDisplay.u}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-neutral-600 font-mono text-xs">
                        {b.expirationDate ? formatDate(b.expirationDate) : '기한없음'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-700">
                        {b.status === 'no_expiry' ? '-' : `${b.remainDays}일`}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className="px-2 py-0.5 rounded text-[11px] font-bold"
                          style={{ backgroundColor: cfg.bg, color: cfg.text }}
                        >
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 생산 계획 vs 실적 */}
      <div className="bg-white rounded border border-neutral-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-5">
        <h2 className="text-[15px] font-semibold text-neutral-900 mb-4">
          생산 계획 vs 실적
          <span className="ml-2 text-[11px] font-normal text-neutral-400">최근 30일</span>
        </h2>
        {data.production.length === 0 ? (
          <div className="text-center py-8 text-neutral-400 text-sm">생산 데이터 없음</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50">
                    <th className="px-4 py-2.5 border-b border-neutral-200 text-center text-[12px] font-bold text-neutral-600">날짜</th>
                    <th className="px-4 py-2.5 border-b border-neutral-200 text-center text-[12px] font-bold text-neutral-600">공장</th>
                    <th className="px-4 py-2.5 border-b border-neutral-200 text-right text-[12px] font-bold text-neutral-600">계획량</th>
                    <th className="px-4 py-2.5 border-b border-neutral-200 text-right text-[12px] font-bold text-neutral-600">실적량</th>
                    <th className="px-4 py-2.5 border-b border-neutral-200 text-center text-[12px] font-bold text-neutral-600">달성률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pagedProd.map((p, idx) => {
                    const planD = fmtQty(p.planQty);
                    const actualD = fmtQty(p.actualQty);
                    const rateColor = p.rate >= 90 ? '#1565C0' : '#E65100';
                    return (
                      <tr key={idx} className="hover:bg-neutral-50">
                        <td className="px-4 py-2.5 text-center font-mono text-xs text-neutral-600">{formatDate(p.date)}</td>
                        <td className="px-4 py-2.5 text-center text-neutral-700">{p.plant}</td>
                        <td className="px-4 py-2.5 text-right text-neutral-700">
                          {planD.v} <span className="text-[10px] text-neutral-400">{planD.u}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-neutral-900">
                          {actualD.v} <span className="text-[10px] text-neutral-400">{actualD.u}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-bold text-sm" style={{ color: rateColor }}>
                            {p.planQty > 0 ? `${p.rate}%` : '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalProdPages > 1 && (
              <div className="flex justify-center items-center gap-3 mt-4 text-sm text-neutral-600">
                <button
                  onClick={() => setProdPage((p) => Math.max(1, p - 1))}
                  disabled={prodPage === 1}
                  className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <span>{prodPage} / {totalProdPages}</span>
                <button
                  onClick={() => setProdPage((p) => Math.min(totalProdPages, p + 1))}
                  disabled={prodPage === totalProdPages}
                  className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon, color, sub }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'red' | 'neutral';
  sub?: string;
}) {
  const colorMap = {
    blue:    { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]' },
    green:   { bg: 'bg-[#E8F5E9]', text: 'text-[#2E7D32]' },
    red:     { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]' },
    neutral: { bg: 'bg-[#FAFAFA]', text: 'text-[#424242]' },
  };
  const c = colorMap[color];
  return (
    <div className={`p-5 rounded border border-neutral-200 shadow-[0_1px_3px_rgba(0,0,0,0.08)] ${c.bg}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[12px] font-medium text-neutral-600">{title}</span>
      </div>
      <div className={`text-[20px] font-bold ${c.text}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}
