'use client';

import { Suspense, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Star, Search, Trash2, ExternalLink, Package, AlertTriangle,
  TrendingUp, CircleDollarSign, ChevronRight, Plus, X,
  ShieldAlert, Clock, Boxes, BarChart3, Layers, ChevronDown, CheckCircle2
} from 'lucide-react';
import { useFavorites } from '@/hooks/use-favorites';
import { useKoreanInput } from '@/hooks/use-korean-input';
import { useDashboardData } from '@/hooks/use-dashboard';
import { useUiStore } from '@/store/ui-store';
import { IntegratedItem } from '@/types/analysis';

// ── 경보 계산 ─────────────────────────────────────────────────────────────────
function getAlerts(item: IntegratedItem) {
  const alerts: { label: string; color: string }[] = [];
  const coverageDays = item.inventory.ads > 0 ? item.inventory.totalStock / item.inventory.ads : Infinity;

  if (item.totalUnfulfilledQty > 0)
    alerts.push({ label: '미납 발생', color: 'bg-red-100 text-red-700 border-red-200' });
  if (item.inventory.totalStock === 0 && item.totalReqQty > 0)
    alerts.push({ label: '재고 없음', color: 'bg-red-100 text-red-700 border-red-200' });
  else if (coverageDays < 7 && item.inventory.ads > 0)
    alerts.push({ label: '결품 위험', color: 'bg-orange-100 text-orange-700 border-orange-200' });
  else if (coverageDays < 14 && item.inventory.ads > 0)
    alerts.push({ label: '재고 주의', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' });
  if ((item.inventory.statusBreakdown?.disposed || 0) > 0)
    alerts.push({ label: '폐기 재고', color: 'bg-red-100 text-red-700 border-red-200' });
  if (item.inventory.status === 'imminent')
    alerts.push({ label: '유통 임박', color: 'bg-orange-100 text-orange-700 border-orange-200' });

  return alerts;
}

// ── 재고 상태 미니 바 ──────────────────────────────────────────────────────────
function StockMiniBar({ item }: { item: IntegratedItem }) {
  const total = item.inventory.totalStock;
  if (total === 0) return <div className="w-full h-1.5 bg-neutral-100 rounded-full" />;
  const bd = item.inventory.statusBreakdown || {};
  return (
    <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden flex">
      <div style={{ width: `${((bd.healthy || 0) / total) * 100}%` }} className="bg-[#42A5F5]" />
      <div style={{ width: `${((bd.no_expiry || 0) / total) * 100}%` }} className="bg-[#66BB6A]" />
      <div style={{ width: `${((bd.critical || 0) / total) * 100}%` }} className="bg-[#FBC02D]" />
      <div style={{ width: `${((bd.imminent || 0) / total) * 100}%` }} className="bg-[#F57C00]" />
      <div style={{ width: `${((bd.disposed || 0) / total) * 100}%` }} className="bg-[#E53935]" />
    </div>
  );
}

// ── 납품률 원형 표시 ───────────────────────────────────────────────────────────
function FulfillmentRing({ rate }: { rate: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ - (rate / 100) * circ;
  const color = rate >= 95 ? '#42A5F5' : rate >= 80 ? '#FBC02D' : '#E53935';
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="#E5E7EB" strokeWidth="4" />
      <circle
        cx="24" cy="24" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="24" textAnchor="middle" dominantBaseline="central"
        fontSize="9" fontWeight="bold" fill={color}>
        {rate.toFixed(0)}%
      </text>
    </svg>
  );
}

// ── 제품 카드 ─────────────────────────────────────────────────────────────────
function ProductCard({
  item, onRemove, unitMode,
}: {
  item: IntegratedItem;
  onRemove: () => void;
  unitMode: string;
}) {
  const alerts = getAlerts(item);
  const rate = item.totalReqQty > 0 ? (item.totalActualQty / item.totalReqQty) * 100 : 100;
  const coverageDays = item.inventory.ads > 0 ? item.inventory.totalStock / item.inventory.ads : null;

  const fmt = (val: number) => {
    if (unitMode === 'BOX' && item.umrezBox > 0) {
      return `${(val / item.umrezBox).toLocaleString(undefined, { maximumFractionDigits: 1 })} BOX`;
    }
    return `${val.toLocaleString()} ${item.unit}`;
  };

  const statusColor: Record<string, string> = {
    healthy: 'bg-blue-50 border-blue-200',
    no_expiry: 'bg-green-50 border-green-200',
    critical: 'bg-yellow-50 border-yellow-200',
    imminent: 'bg-orange-50 border-orange-200',
    disposed: 'bg-red-50 border-red-200',
  };
  const hasIssue = alerts.length > 0;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all flex flex-col ${hasIssue ? 'border-red-200' : 'border-neutral-200'}`}>

      {/* ① 헤더 — 고정 높이 구조 */}
      <div className="p-4 pb-3 border-b border-neutral-100 flex flex-col gap-2">
        {/* 제품명 행 — 항상 2줄 영역 확보 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Link href={`/product/${item.code}`} className="group flex items-start gap-1">
              <p className="text-sm font-bold text-neutral-900 group-hover:text-blue-600 transition-colors leading-snug line-clamp-2 min-h-[36px]">
                {item.name}
              </p>
              <ExternalLink size={11} className="text-neutral-300 group-hover:text-blue-400 shrink-0 mt-0.5" />
            </Link>
            <p className="text-[11px] text-neutral-400 font-mono mt-0.5">{item.code}</p>
          </div>
          <button
            onClick={onRemove}
            className="p-1 rounded-lg hover:bg-red-50 text-neutral-300 hover:text-red-400 transition-colors shrink-0"
            title="즐겨찾기 제거"
          >
            <X size={14} />
          </button>
        </div>

        {/* 경보 배지 — 항상 20px 높이 영역 확보 (없으면 빈 줄) */}
        <div className="flex flex-wrap gap-1 min-h-[20px] items-center">
          {alerts.map((a, i) => (
            <span key={i} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${a.color}`}>
              {a.label}
            </span>
          ))}
        </div>
      </div>

      {/* ② 납품률 + 메트릭 — 테이블형 2×2 격자 */}
      <div className="px-4 pt-4 pb-3 flex items-stretch gap-3">
        {/* 납품률 링 */}
        <div className="flex items-center justify-center shrink-0">
          <FulfillmentRing rate={rate} />
        </div>

        {/* 2×2 메트릭 격자 — 테두리로 칸 구분해 정렬 고정 */}
        <div className="flex-1 grid grid-cols-2 border border-neutral-100 rounded-xl overflow-hidden">
          <MetricCell
            icon={Boxes} label="현재 재고"
            value={fmt(item.inventory.totalStock)}
            warn={item.inventory.totalStock === 0}
            borderR borderB
          />
          <MetricCell
            icon={TrendingUp} label="ADS (60일)"
            value={`${fmt(item.inventory.ads)}/일`}
            borderB
          />
          <MetricCell
            icon={Clock} label="재고 커버리지"
            value={coverageDays === null ? '-' : coverageDays === Infinity ? '∞' : `${coverageDays.toFixed(0)}일`}
            warn={coverageDays !== null && coverageDays !== Infinity && coverageDays < 14}
            borderR
          />
          <MetricCell
            icon={AlertTriangle} label="미납 손실"
            value={item.totalUnfulfilledValue > 0 ? `${Math.round(item.totalUnfulfilledValue / 1000000).toLocaleString()}백만` : '없음'}
            warn={item.totalUnfulfilledValue > 0}
          />
        </div>
      </div>

      {/* ③ 재고 구성 바 */}
      <div className="px-4 pb-2">
        <StockMiniBar item={item} />
        <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
          <span>플랜트 {fmt(item.inventory.plantStock)}</span>
          <span>FBH {fmt(item.inventory.fbhStock)}</span>
        </div>
      </div>

      {/* ④ 기간 매출 — 항상 카드 맨 아래 */}
      <div className={`mx-4 mb-4 mt-auto pt-3 rounded-xl px-3 py-2 flex items-center justify-between ${statusColor[item.inventory.status] || 'bg-neutral-50 border-neutral-100'} border`}>
        <span className="text-[11px] text-neutral-500 flex items-center gap-1">
          <CircleDollarSign size={11} /> 기간 매출
        </span>
        <span className="text-xs font-bold text-neutral-800">
          {Math.round(item.totalSalesAmount / 1000000).toLocaleString()}백만원
        </span>
      </div>
    </div>
  );
}

// 테이블형 메트릭 셀 — 테두리로 칸을 나눠 정렬 고정
function MetricCell({ icon: Icon, label, value, warn, borderR, borderB }: {
  icon: any; label: string; value: string;
  warn?: boolean; borderR?: boolean; borderB?: boolean;
}) {
  return (
    <div className={`flex flex-col justify-center gap-0.5 px-2.5 py-2
      ${borderR ? 'border-r border-neutral-100' : ''}
      ${borderB ? 'border-b border-neutral-100' : ''}
    `}>
      <div className="flex items-center gap-0.5 text-[10px] text-neutral-400">
        <Icon size={9} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={`text-xs font-bold truncate ${warn ? 'text-red-600' : 'text-neutral-800'}`}>
        {value}
      </p>
    </div>
  );
}

// ── 빈 카드 (integratedArray에 없는 즐겨찾기) ─────────────────────────────────
function GhostCard({ matnr, name, onRemove }: { matnr: string; name: string; onRemove: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-neutral-200 p-5 flex flex-col gap-3 opacity-60">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-bold text-neutral-700">{name || matnr}</p>
          <p className="text-[11px] text-neutral-400 font-mono">{matnr}</p>
        </div>
        <button onClick={onRemove} className="p-1 rounded hover:bg-red-50 text-neutral-300 hover:text-red-400 transition-colors">
          <X size={14} />
        </button>
      </div>
      <p className="text-xs text-neutral-400">조회 기간 내 데이터 없음</p>
      <Link href={`/product/${matnr}`} className="text-[11px] text-blue-500 hover:underline flex items-center gap-1">
        <ExternalLink size={10} /> 제품 상세 보기
      </Link>
    </div>
  );
}

// ── 계층 탐색 제품 목록 ────────────────────────────────────────────────────────
function HierarchyProductList({
  items, isFavorite, toggle,
}: { items: IntegratedItem[]; isFavorite: (c: string) => boolean; toggle: (c: string, n: string) => void }) {
  if (items.length === 0) return (
    <div className="py-10 text-center text-neutral-400 text-sm">해당 계층에 제품이 없습니다</div>
  );
  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((item) => {
        const starred = isFavorite(item.code);
        return (
          <li key={item.code} className="flex items-center justify-between px-4 py-2.5 hover:bg-neutral-50 transition-colors">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-neutral-900 truncate">{item.name}</p>
              <p className="text-[11px] text-neutral-400 font-mono">{item.code}</p>
            </div>
            <button
              onClick={() => toggle(item.code, item.name)}
              className={`ml-3 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shrink-0 ${
                starred
                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-yellow-50 hover:text-yellow-600'
              }`}
            >
              <Star size={11} fill={starred ? '#FBBF24' : 'none'} className={starred ? 'text-yellow-400' : 'text-neutral-400'} />
              {starred ? '추가됨' : '추가'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── 검색 패널 (드로어) ────────────────────────────────────────────────────────
function SearchPanel({ isOpen, onClose, data, isFavorite, toggle }: any) {
  const [mode, setMode] = useState<'search' | 'hierarchy'>('search');

  // ── 직접 검색 상태 ──────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputProps = useKoreanInput(searchTerm, setSearchTerm);

  // ── 계층 탐색 상태 ──────────────────────────────────────────────────────────
  const [selL1, setSelL1] = useState<string | null>(null);
  const [selL2, setSelL2] = useState<string | null>(null);
  const [selL3, setSelL3] = useState<string | null>(null);

  const allItems: IntegratedItem[] = data?.integratedArray ?? [];

  // 직접 검색 결과
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const q = searchTerm.toLowerCase();
    return allItems.filter((i) => i.name.toLowerCase().includes(q) || i.code.includes(q)).slice(0, 50);
  }, [searchTerm, allItems]);

  // 계층 옵션 계산
  const l1Options = useMemo(
    () => [...new Set(allItems.map((i) => i.brand).filter(Boolean))].sort(),
    [allItems]
  );
  const l2Options = useMemo(
    () => selL1 ? [...new Set(allItems.filter((i) => i.brand === selL1).map((i) => i.category).filter(Boolean))].sort() : [],
    [allItems, selL1]
  );
  const l3Options = useMemo(
    () => selL1 && selL2 ? [...new Set(allItems.filter((i) => i.brand === selL1 && i.category === selL2).map((i) => i.family).filter(Boolean))].sort() : [],
    [allItems, selL1, selL2]
  );

  // 현재 선택 기준 필터된 제품 목록
  const hierarchyProducts = useMemo(() => {
    if (!selL1) return [];
    return allItems.filter((i) => {
      if (selL3) return i.brand === selL1 && i.category === selL2 && i.family === selL3;
      if (selL2) return i.brand === selL1 && i.category === selL2;
      return i.brand === selL1;
    });
  }, [allItems, selL1, selL2, selL3]);

  const addedCount  = hierarchyProducts.filter((i) => isFavorite(i.code)).length;
  const toAddCount  = hierarchyProducts.length - addedCount;

  // 일괄 추가 (이미 추가된 항목은 제외)
  const handleBulkAdd = () => {
    hierarchyProducts.forEach((item) => {
      if (!isFavorite(item.code)) toggle(item.code, item.name);
    });
  };

  // 계층별 제품 수
  const countL1 = (l1: string) => allItems.filter((i) => i.brand === l1).length;
  const countL2 = (l2: string) => allItems.filter((i) => i.brand === selL1 && i.category === l2).length;
  const countL3 = (l3: string) => allItems.filter((i) => i.brand === selL1 && i.category === selL2 && i.family === l3).length;

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[460px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200">
          <h2 className="text-base font-bold text-neutral-900">즐겨찾기 제품 추가</h2>
          <button onClick={onClose} className="p-2 hover:bg-neutral-100 rounded-full text-neutral-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 모드 탭 */}
        <div className="flex border-b border-neutral-200 bg-neutral-50">
          <button
            onClick={() => setMode('search')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold transition-all ${
              mode === 'search'
                ? 'text-blue-600 bg-white border-b-2 border-blue-500 -mb-px'
                : 'text-neutral-400 hover:text-neutral-600'
            }`}
          >
            <Search size={13} />
            직접 검색
          </button>
          <button
            onClick={() => setMode('hierarchy')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold transition-all ${
              mode === 'hierarchy'
                ? 'text-blue-600 bg-white border-b-2 border-blue-500 -mb-px'
                : 'text-neutral-400 hover:text-neutral-600'
            }`}
          >
            <Layers size={13} />
            계층 탐색
          </button>
        </div>

        {/* ── 직접 검색 모드 ── */}
        {mode === 'search' && (
          <>
            <div className="p-4 border-b border-neutral-100">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-neutral-400" size={15} />
                <input
                  autoFocus
                  type="text"
                  placeholder="제품명 또는 코드 검색..."
                  {...searchInputProps}
                  className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {searchTerm.trim() === '' ? (
                <div className="p-8 text-center text-neutral-400 text-sm">제품명이나 코드를 입력하세요</div>
              ) : searchResults.length === 0 ? (
                <div className="p-8 text-center text-neutral-400 text-sm">검색 결과 없음</div>
              ) : (
                <HierarchyProductList items={searchResults} isFavorite={isFavorite} toggle={toggle} />
              )}
            </div>
          </>
        )}

        {/* ── 계층 탐색 모드 ── */}
        {mode === 'hierarchy' && (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* 브레드크럼 */}
            {selL1 && (
              <div className="px-4 py-2 flex items-center gap-1 flex-wrap bg-blue-50 border-b border-blue-100 text-xs">
                <button
                  onClick={() => { setSelL1(null); setSelL2(null); setSelL3(null); }}
                  className="text-blue-500 hover:text-blue-700 font-medium hover:underline"
                >
                  전체
                </button>
                <ChevronRight size={11} className="text-blue-300" />
                <button
                  onClick={() => { setSelL2(null); setSelL3(null); }}
                  className={`font-medium ${!selL2 ? 'text-neutral-800' : 'text-blue-500 hover:text-blue-700 hover:underline'}`}
                >
                  {selL1}
                </button>
                {selL2 && (
                  <>
                    <ChevronRight size={11} className="text-blue-300" />
                    <button
                      onClick={() => setSelL3(null)}
                      className={`font-medium ${!selL3 ? 'text-neutral-800' : 'text-blue-500 hover:text-blue-700 hover:underline'}`}
                    >
                      {selL2}
                    </button>
                  </>
                )}
                {selL3 && (
                  <>
                    <ChevronRight size={11} className="text-blue-300" />
                    <span className="font-medium text-neutral-800">{selL3}</span>
                  </>
                )}
              </div>
            )}

            {/* 일괄 추가 바 */}
            {selL1 && hierarchyProducts.length > 0 && (
              <div className="px-4 py-2.5 bg-white border-b border-neutral-100 flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-500 flex items-center gap-1.5">
                  <span className="font-bold text-neutral-800">{hierarchyProducts.length}개</span> 제품
                  {addedCount > 0 && (
                    <span className="flex items-center gap-0.5 text-yellow-600 font-medium">
                      <CheckCircle2 size={11} />
                      {addedCount}개 추가됨
                    </span>
                  )}
                </span>
                {toAddCount > 0 ? (
                  <button
                    onClick={handleBulkAdd}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={12} />
                    전체 추가 ({toAddCount}개)
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold text-green-600">
                    <CheckCircle2 size={13} />
                    모두 추가됨
                  </span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">

              {/* L1 — 브랜드 선택 */}
              {!selL1 && (
                <div className="p-3">
                  <p className="text-[11px] text-neutral-400 font-bold tracking-wide px-1 mb-2 uppercase">
                    브랜드 선택 (PRDHA 1)
                  </p>
                  {l1Options.length === 0 ? (
                    <div className="py-10 text-center text-neutral-400 text-sm">데이터가 없습니다</div>
                  ) : (
                    <div className="space-y-1">
                      {l1Options.map((l1) => (
                        <button
                          key={l1}
                          onClick={() => { setSelL1(l1); setSelL2(null); setSelL3(null); }}
                          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors text-left group"
                        >
                          <span className="text-sm font-semibold text-neutral-800 group-hover:text-blue-700">{l1}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-neutral-400 bg-neutral-100 group-hover:bg-blue-100 group-hover:text-blue-600 px-2 py-0.5 rounded-full font-medium transition-colors">
                              {countL1(l1)}개
                            </span>
                            <ChevronRight size={14} className="text-neutral-300 group-hover:text-blue-400 transition-colors" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* L2 — 카테고리 선택 + 제품 목록 */}
              {selL1 && !selL2 && (
                <>
                  {l2Options.length > 0 && (
                    <div className="p-3 border-b border-neutral-100">
                      <p className="text-[11px] text-neutral-400 font-bold tracking-wide px-1 mb-2 uppercase">
                        카테고리 선택 (PRDHA 2)
                      </p>
                      <div className="space-y-1">
                        {l2Options.map((l2) => (
                          <button
                            key={l2}
                            onClick={() => { setSelL2(l2); setSelL3(null); }}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors text-left group"
                          >
                            <span className="text-sm font-semibold text-neutral-800 group-hover:text-blue-700">{l2}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-neutral-400 bg-neutral-100 group-hover:bg-blue-100 group-hover:text-blue-600 px-2 py-0.5 rounded-full font-medium transition-colors">
                                {countL2(l2)}개
                              </span>
                              <ChevronRight size={14} className="text-neutral-300 group-hover:text-blue-400 transition-colors" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-[11px] text-neutral-400 font-bold tracking-wide px-1 mb-1 uppercase">
                      전체 제품 ({hierarchyProducts.length})
                    </p>
                    <HierarchyProductList items={hierarchyProducts} isFavorite={isFavorite} toggle={toggle} />
                  </div>
                </>
              )}

              {/* L3 — 제품군 선택 + 제품 목록 */}
              {selL1 && selL2 && !selL3 && (
                <>
                  {l3Options.length > 0 && (
                    <div className="p-3 border-b border-neutral-100">
                      <p className="text-[11px] text-neutral-400 font-bold tracking-wide px-1 mb-2 uppercase">
                        제품군 선택 (PRDHA 3)
                      </p>
                      <div className="space-y-1">
                        {l3Options.map((l3) => (
                          <button
                            key={l3}
                            onClick={() => setSelL3(l3)}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-blue-50 transition-colors text-left group"
                          >
                            <span className="text-sm font-semibold text-neutral-800 group-hover:text-blue-700">{l3}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-neutral-400 bg-neutral-100 group-hover:bg-blue-100 group-hover:text-blue-600 px-2 py-0.5 rounded-full font-medium transition-colors">
                                {countL3(l3)}개
                              </span>
                              <ChevronRight size={14} className="text-neutral-300 group-hover:text-blue-400 transition-colors" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-[11px] text-neutral-400 font-bold tracking-wide px-1 mb-1 uppercase">
                      해당 카테고리 제품 ({hierarchyProducts.length})
                    </p>
                    <HierarchyProductList items={hierarchyProducts} isFavorite={isFavorite} toggle={toggle} />
                  </div>
                </>
              )}

              {/* 최종 L3 선택 — 제품 목록만 */}
              {selL1 && selL2 && selL3 && (
                <div className="p-3">
                  <p className="text-[11px] text-neutral-400 font-bold tracking-wide px-1 mb-1 uppercase">
                    제품 목록 ({hierarchyProducts.length})
                  </p>
                  <HierarchyProductList items={hierarchyProducts} isFavorite={isFavorite} toggle={toggle} />
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
function FavoritesPageInner() {
  const { favorites, isFavorite, toggle } = useFavorites();
  const { data, isLoading } = useDashboardData();
  const { unitMode } = useUiStore();
  const [searchOpen, setSearchOpen] = useState(false);

  // 즐겨찾기 + integratedArray 매핑
  const favItemMap = useMemo(() => {
    const map = new Map<string, IntegratedItem>();
    if (data?.integratedArray) {
      (data.integratedArray as IntegratedItem[]).forEach((item) => map.set(item.code, item));
    }
    return map;
  }, [data]);

  const favItems = useMemo(
    () => favorites.map((f) => ({ fav: f, item: favItemMap.get(f.matnr) ?? null })),
    [favorites, favItemMap]
  );

  // 요약 KPI
  const summary = useMemo(() => {
    const withData = favItems.filter((f) => f.item !== null);
    const issueCount = withData.filter((f) => f.item && getAlerts(f.item).length > 0).length;
    const totalSales = withData.reduce((s, f) => s + (f.item?.totalSalesAmount || 0), 0);
    const totalMissed = withData.reduce((s, f) => s + (f.item?.totalUnfulfilledValue || 0), 0);
    return { total: favorites.length, withData: withData.length, issueCount, totalSales, totalMissed };
  }, [favItems, favorites.length]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* 헤더 */}
      <div className="flex items-end justify-between pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
            <Star size={20} className="text-yellow-400" fill="#FBBF24" />
            내 관심 제품 현황
          </h1>
          <p className="text-[12px] text-neutral-500 mt-1">즐겨찾기한 제품의 재고·납품·미납 현황을 한눈에 확인하세요</p>
        </div>
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 text-white text-xs font-bold rounded-xl hover:bg-neutral-700 transition-colors"
        >
          <Plus size={14} /> 제품 추가
        </button>
      </div>

      {/* 요약 KPI (데이터 있을 때만) */}
      {summary.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryKpi label="관심 제품" value={`${summary.total}개`} icon={Star} color="yellow" />
          <SummaryKpi label="이슈 발생" value={`${summary.issueCount}개`} icon={ShieldAlert} color={summary.issueCount > 0 ? 'red' : 'green'} />
          <SummaryKpi label="기간 총매출" value={`${Math.round(summary.totalSales / 1000000).toLocaleString()}백만`} icon={BarChart3} color="blue" />
          <SummaryKpi label="미납 손실" value={`${Math.round(summary.totalMissed / 1000000).toLocaleString()}백만`} icon={AlertTriangle} color={summary.totalMissed > 0 ? 'orange' : 'green'} />
        </div>
      )}

      {/* 즐겨찾기 없을 때 */}
      {favorites.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-20 h-20 bg-yellow-50 rounded-full flex items-center justify-center">
            <Star size={36} className="text-yellow-300" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-bold text-neutral-800">아직 관심 제품이 없습니다</h3>
            <p className="text-sm text-neutral-500 mt-1">담당 제품을 추가하면 재고·납품 현황을 한눈에 볼 수 있습니다</p>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-neutral-900 text-white text-sm font-bold rounded-xl hover:bg-neutral-700 transition-colors"
          >
            <Plus size={15} /> 첫 제품 추가하기
          </button>
        </div>
      )}

      {/* 제품 카드 그리드 */}
      {favItems.length > 0 && (
        <>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400 py-2">
              <div className="w-4 h-4 border-2 border-neutral-200 border-t-blue-400 rounded-full animate-spin" />
              데이터 불러오는 중...
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {favItems.map(({ fav, item }) =>
              item ? (
                <ProductCard
                  key={fav.matnr}
                  item={item}
                  unitMode={unitMode}
                  onRemove={() => toggle(fav.matnr, fav.product_name || '')}
                />
              ) : (
                <GhostCard
                  key={fav.matnr}
                  matnr={fav.matnr}
                  name={fav.product_name || ''}
                  onRemove={() => toggle(fav.matnr, fav.product_name || '')}
                />
              )
            )}

            {/* 추가 버튼 카드 */}
            <button
              onClick={() => setSearchOpen(true)}
              className="bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 hover:border-neutral-400 hover:bg-neutral-100 transition-all flex flex-col items-center justify-center gap-2 py-10 text-neutral-400 hover:text-neutral-600 min-h-[200px]"
            >
              <Plus size={28} />
              <span className="text-sm font-medium">제품 추가</span>
            </button>
          </div>
        </>
      )}

      {/* 검색 패널 */}
      <SearchPanel
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        data={data}
        isFavorite={isFavorite}
        toggle={toggle}
      />
    </div>
  );
}

function SummaryKpi({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  const styles: Record<string, string> = {
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
  };
  const s = styles[color] || styles.blue;
  return (
    <div className={`rounded-2xl border p-4 ${s}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold opacity-70 mb-1">
        <Icon size={11} />
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin" />
      </div>
    }>
      <FavoritesPageInner />
    </Suspense>
  );
}
