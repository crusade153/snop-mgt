// app/sales-report/page.tsx
// 매출 리포트 — SAP 청구매출(SD_SO) 단독 장표.
//
// 다른 화면과 데이터를 공유하지 않는다(전용 액션·전용 캐시 키). 계산·판정은 lib/sales-report/ 에 있고
// 여기서는 표시·필터·페이지네이션만 한다.
'use client';

import { Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Minus,
  ReceiptText,
  RefreshCw,
  Search,
  Share2,
  TrendingUp,
} from 'lucide-react';
import { getSalesReport } from '@/actions/sales-report-actions';
import SalesRankBars, { type RankBarItem } from '@/components/charts/sales-rank-bars';
import SalesTrendChart from '@/components/charts/sales-trend-chart';
import InfoTooltip from '@/components/info-tooltip';
import { useKoreanInput } from '@/hooks/use-korean-input';
import { useUrlFilters } from '@/hooks/use-url-filters';
import {
  SALES_BASIS_TEXT,
  formatEok,
  formatQty,
  formatRate,
  formatWon,
  type SalesProductRow,
} from '@/lib/sales-report/board';
import {
  SALES_DIMENSION_LABELS,
  SALES_PRESET_LABELS,
  isIsoDate,
  resolvePreset,
  type SalesDimension,
  type SalesPresetKey,
  type SalesVtweg,
} from '@/lib/sales-report/query';

const PRESET_KEYS: SalesPresetKey[] = ['m3', 'm6', 'm12', 'thisYear', 'lastYear'];
const DIMENSION_KEYS: SalesDimension[] = ['channel', 'brand', 'matkl', 'vkgrp'];

const VTWEG_LABELS: Record<SalesVtweg, string> = {
  ALL: '전체',
  '10': '내수',
  '20': '수출',
};

const ROWS_PER_PAGE = 15;

/** 구성비 차트에 세우는 최대 조각 수. 나머지는 「기타」로 접는다 — 색을 늘리지 않기 위한 것이다. */
const RANK_VISIBLE = 8;

function SalesReportInner() {
  const { getParam, getIntParam, setParams, copyShareUrl } = useUrlFilters();

  // 기본 기간은 최근 12개월. 프리셋을 URL 에 담아 링크 공유가 되게 한다.
  const preset = (getParam('preset', 'm12') || 'm12') as SalesPresetKey;
  const fallback = useMemo(
    () => resolvePreset(PRESET_KEYS.includes(preset) ? preset : 'm12', new Date()),
    [preset],
  );

  const fromParam = getParam('from', '');
  const toParam = getParam('to', '');
  const from = isIsoDate(fromParam) ? fromParam : fallback.from;
  const to = isIsoDate(toParam) ? toParam : fallback.to;

  const vtweg = (getParam('vtweg', 'ALL') || 'ALL') as SalesVtweg;
  const channel = getParam('ch', '');
  const dimension = (getParam('dim', 'channel') || 'channel') as SalesDimension;
  const search = getParam('q', '');
  const page = getIntParam('page', 1);

  const searchInput = useKoreanInput(search, (value) => setParams({ q: value || null, page: null }));
  const [showBasis, setShowBasis] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['sales-report', from, to, vtweg, channel],
    queryFn: () => getSalesReport({ from, to, vtweg, channel }),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const board = data?.board ?? null;
  const kpi = board?.kpi;

  // ── 구성비 차트 데이터 ───────────────────────────────────
  const rankItems: RankBarItem[] = useMemo(() => {
    const list = board?.ranks[dimension] ?? [];
    if (list.length <= RANK_VISIBLE) {
      return list.map((row) => ({ key: row.key, label: row.key, value: row.net, share: row.share }));
    }
    const head = list.slice(0, RANK_VISIBLE);
    const tail = list.slice(RANK_VISIBLE);
    return [
      ...head.map((row) => ({ key: row.key, label: row.key, value: row.net, share: row.share })),
      {
        key: '__rest__',
        label: `기타 ${tail.length}개`,
        value: tail.reduce((sum, row) => sum + row.net, 0),
        share: tail.reduce((sum, row) => sum + row.share, 0),
      },
    ];
  }, [board, dimension]);

  const customerItems: RankBarItem[] = useMemo(
    () =>
      (board?.customers ?? []).slice(0, 10).map((row) => ({
        key: row.code,
        label: row.name,
        sub: row.code,
        value: row.net,
        share: row.share,
      })),
    [board],
  );

  // ── 제품 표: 검색 → 페이지네이션 ─────────────────────────
  const filteredProducts: SalesProductRow[] = useMemo(() => {
    const rows = board?.products ?? [];
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(keyword) ||
        row.matnr.includes(keyword) ||
        row.matkl.toLowerCase().includes(keyword) ||
        row.brand.toLowerCase().includes(keyword),
    );
  }, [board, search]);

  const totalPages = Math.max(Math.ceil(filteredProducts.length / ROWS_PER_PAGE), 1);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const pageRows = filteredProducts.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  const applyPreset = (key: SalesPresetKey) => {
    // 프리셋을 고르면 직접 입력한 날짜는 지운다 — 둘이 동시에 살아 있으면 어느 쪽이 이겼는지 알 수 없다.
    setParams({ preset: key, from: null, to: null, page: null });
  };

  const channelOptions = board?.ranks.channel.map((row) => row.key) ?? [];

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* ── 머리말 ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <ReceiptText size={20} className="text-[#1565C0]" />
            매출 리포트
            <InfoTooltip text="SAP 청구매출(SD_SO)의 빌링일자(FKDAT) 기준. 「종합 현황」의 납품매출과는 기준이 다릅니다." size={14} />
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {from} ~ {to}
            {data?.previous.from && (
              <span className="text-neutral-400"> · 전년 동기 {data.previous.from} ~ {data.previous.to}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBasis((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          >
            판정 기준
          </button>
          <button
            onClick={copyShareUrl}
            className="px-3 py-1.5 text-xs font-medium rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50 flex items-center gap-1.5"
          >
            <Share2 size={13} /> 링크 복사
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3 py-1.5 text-xs font-medium rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
      </div>

      {/* 판정 기준은 접었다 펼 수 있게 두되 화면 안에 그대로 노출한다. */}
      {showBasis && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs leading-relaxed text-neutral-600 whitespace-pre-line">
          {SALES_BASIS_TEXT}
        </div>
      )}

      {/* ── 필터 한 줄 ──────────────────────────────────── */}
      <div className="rounded-lg border border-neutral-200 bg-white p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {PRESET_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                preset === key && !fromParam
                  ? 'bg-[#E3F2FD] text-[#1565C0]'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {SALES_PRESET_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-neutral-200 mx-1" />

        <input
          type="date"
          value={from}
          onChange={(e) => setParams({ from: e.target.value, to, page: null })}
          className="px-2 py-1.5 text-xs border border-neutral-200 rounded text-neutral-700"
        />
        <span className="text-xs text-neutral-400">~</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setParams({ from, to: e.target.value, page: null })}
          className="px-2 py-1.5 text-xs border border-neutral-200 rounded text-neutral-700"
        />

        <div className="h-5 w-px bg-neutral-200 mx-1" />

        <select
          value={vtweg}
          onChange={(e) => setParams({ vtweg: e.target.value === 'ALL' ? null : e.target.value, page: null })}
          className="px-2 py-1.5 text-xs border border-neutral-200 rounded text-neutral-700"
        >
          {(Object.keys(VTWEG_LABELS) as SalesVtweg[]).map((key) => (
            <option key={key} value={key}>
              유통채널 {VTWEG_LABELS[key]}
            </option>
          ))}
        </select>

        <select
          value={channel}
          onChange={(e) => setParams({ ch: e.target.value || null, page: null })}
          className="px-2 py-1.5 text-xs border border-neutral-200 rounded text-neutral-700 max-w-[180px]"
        >
          <option value="">판매채널 전체</option>
          {channelOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {/* ── 오류 ────────────────────────────────────────── */}
      {data && !data.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {data.message ?? '매출 리포트를 불러오지 못했습니다.'}
        </div>
      )}

      {isLoading && (
        <div className="py-24 text-center text-sm text-neutral-400">매출 데이터를 불러오는 중…</div>
      )}

      {kpi && board && (
        <>
          {/* ── KPI ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile
              title="차감후 매출액"
              value={formatEok(kpi.net)}
              hint={formatWon(kpi.net)}
              accent
              delta={kpi.yoyRate}
              deltaLabel="전년 동기"
            />
            <KpiTile
              title="총매출액"
              value={formatEok(kpi.gross)}
              hint={`일평균 ${formatEok(kpi.dailyAvg, 2)}`}
            />
            <KpiTile
              title="반품·조정 차감"
              value={formatEok(kpi.deduction)}
              hint={`총매출액의 ${kpi.deductionRate.toFixed(1)}%`}
              negative
            />
            <KpiTile
              title="판매수량"
              value={formatQty(kpi.qty)}
              hint="기본단위(대부분 EA)"
            />
            <KpiTile
              title="거래처 · 품목"
              value={`${kpi.customers.toLocaleString()}곳`}
              hint={`품목 ${kpi.items.toLocaleString()}종 · 전표 ${kpi.docs.toLocaleString()}건`}
            />
          </div>

          {/* ── 월별 추이 ─────────────────────────────────── */}
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} className="text-[#1565C0]" />
              <h2 className="text-sm font-bold text-neutral-900">월별 차감후 매출액 추이</h2>
              <InfoTooltip text="같은 달의 전년 값을 나란히 세웁니다. 두 막대는 같은 축(원)입니다." />
              <span className="ml-auto text-xs text-neutral-400">단위: 억원</span>
            </div>
            <SalesTrendChart data={board.monthly} />
          </section>

          {/* ── 구성비 · 거래처 ───────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <h2 className="text-sm font-bold text-neutral-900">구성비</h2>
                <div className="ml-auto flex items-center gap-1">
                  {DIMENSION_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => setParams({ dim: key === 'channel' ? null : key })}
                      className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                        dimension === key
                          ? 'bg-[#E3F2FD] text-[#1565C0]'
                          : 'text-neutral-500 hover:bg-neutral-100'
                      }`}
                    >
                      {SALES_DIMENSION_LABELS[key]}
                    </button>
                  ))}
                </div>
              </div>
              <SalesRankBars items={rankItems} />
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-sm font-bold text-neutral-900">상위 거래처 10</h2>
                <InfoTooltip text="판매처(KUNAG) 기준 차감후 매출액 상위입니다. 구성비 분모는 기간 차감후 매출액입니다." />
              </div>
              <SalesRankBars items={customerItems} color="#eb6834" />
            </section>
          </div>

          {/* ── 제품 리스트 ───────────────────────────────── */}
          <section className="rounded-lg border border-neutral-200 bg-white">
            <div className="p-4 flex flex-wrap items-center gap-3 border-b border-neutral-100">
              <h2 className="text-sm font-bold text-neutral-900">제품별 매출</h2>
              <div className="relative ml-auto">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  {...searchInput}
                  placeholder="제품명 · 코드 · 제품군 · 브랜드 검색"
                  className="pl-8 pr-3 py-1.5 w-[260px] text-xs border border-neutral-200 rounded text-neutral-700 focus:outline-none focus:ring-1 focus:ring-[#1565C0]"
                />
              </div>
              <span className="text-xs text-neutral-500 tabular-nums">
                {filteredProducts.length.toLocaleString()}종
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium w-[90px]">코드</th>
                    <th className="px-4 py-2.5 text-left font-medium">제품명</th>
                    <th className="px-4 py-2.5 text-left font-medium w-[130px]">제품군</th>
                    <th className="px-4 py-2.5 text-left font-medium w-[100px]">브랜드</th>
                    <th className="px-4 py-2.5 text-right font-medium w-[120px]">차감후 매출액</th>
                    <th className="px-4 py-2.5 text-right font-medium w-[70px]">구성비</th>
                    <th className="px-4 py-2.5 text-right font-medium w-[100px]">수량</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pageRows.map((row) => (
                    <tr key={row.matnr} className="hover:bg-neutral-50">
                      <td className="px-4 py-2.5 text-neutral-500 tabular-nums">{row.matnr}</td>
                      <td className="px-4 py-2.5 text-neutral-900 font-medium">{row.name}</td>
                      <td className="px-4 py-2.5 text-neutral-500">{row.matkl}</td>
                      <td className="px-4 py-2.5 text-neutral-500">{row.brand}</td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                          row.net < 0 ? 'text-[#C62828]' : 'text-neutral-900'
                        }`}
                      >
                        {formatEok(row.net, 2)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-400">
                        {row.share.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                        {formatQty(row.qty)}
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-neutral-400">
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100">
              {/* 표가 상한에서 잘렸으면 숨기지 않고 알린다 — 합계와 표가 안 맞는 이유가 이것뿐이라야 한다. */}
              <span className="text-[11px] text-neutral-400">
                {board.productsTruncated
                  ? '차감후 매출액 상위 3,000종만 표시합니다. 상단 합계는 전체 기준입니다.'
                  : '상단 합계와 같은 범위입니다.'}
              </span>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setParams({ page: currentPage > 2 ? String(currentPage - 1) : null })}
                  disabled={currentPage <= 1}
                  className="p-1.5 rounded border border-neutral-200 text-neutral-500 disabled:opacity-40 hover:bg-neutral-50"
                  aria-label="이전 페이지"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-neutral-600 tabular-nums">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setParams({ page: String(currentPage + 1) })}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 rounded border border-neutral-200 text-neutral-500 disabled:opacity-40 hover:bg-neutral-50"
                  aria-label="다음 페이지"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** KPI 한 칸. 숫자는 텍스트 색을 쓰고 색으로만 의미를 싣지 않는다(증감은 화살표가 함께 간다). */
function KpiTile({
  title,
  value,
  hint,
  delta,
  deltaLabel,
  accent,
  negative,
}: {
  title: string;
  value: string;
  hint?: string;
  delta?: number | null;
  deltaLabel?: string;
  accent?: boolean;
  negative?: boolean;
}) {
  const up = typeof delta === 'number' && delta > 0;
  const down = typeof delta === 'number' && delta < 0;
  const DeltaIcon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;

  return (
    <div
      className={`rounded-lg border bg-white p-4 ${
        accent ? 'border-[#1565C0]/30 ring-1 ring-[#1565C0]/10' : 'border-neutral-200'
      }`}
    >
      <div className="text-[11px] font-medium text-neutral-500">{title}</div>
      <div
        className={`mt-1.5 text-xl font-bold tabular-nums ${
          negative ? 'text-[#C62828]' : 'text-neutral-900'
        }`}
      >
        {value}
      </div>
      {typeof delta !== 'undefined' && (
        <div
          className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${
            up ? 'text-[#1565C0]' : down ? 'text-[#C62828]' : 'text-neutral-400'
          }`}
        >
          <DeltaIcon size={12} />
          {formatRate(delta ?? null)}
          {deltaLabel && <span className="font-normal text-neutral-400">{deltaLabel}</span>}
        </div>
      )}
      {hint && <div className="mt-1 text-[11px] text-neutral-400 truncate">{hint}</div>}
    </div>
  );
}

export default function SalesReportPage() {
  // useUrlFilters 가 useSearchParams 를 쓰므로 Suspense 경계가 필요하다.
  return (
    <Suspense fallback={<div className="p-6 text-sm text-neutral-400">불러오는 중…</div>}>
      <SalesReportInner />
    </Suspense>
  );
}
