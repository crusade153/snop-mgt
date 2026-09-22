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
  Download,
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
import { exportToExcel } from '@/lib/excel-export';
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
  SALES_SCOPE_KEYS,
  SALES_SCOPE_LABELS,
  isIsoDate,
  resolvePreset,
  type SalesDimension,
  type SalesPresetKey,
  type SalesProductScope,
  type SalesVtweg,
} from '@/lib/sales-report/query';

const PRESET_KEYS: SalesPresetKey[] = ['m3', 'm6', 'm12', 'thisYear', 'lastYear'];

/**
 * 구성비 축 탭 순서. 「팀」·「채널」을 앞에 둔다 — 주간 요약 장표와 같은 축이라
 * 재고를 그 두 축으로 보던 사람이 매출도 같은 자리에서 찾게 하기 위한 것이다.
 */
const DIMENSION_KEYS: SalesDimension[] = ['team', 'salesChannel', 'channel', 'brand', 'matkl', 'vkgrp'];

/** URL 에 `dim` 이 없을 때의 축. 이 값만 URL 에서 생략된다. */
const DEFAULT_DIMENSION: SalesDimension = 'team';

/** 축마다 「무엇으로 판정했는가」를 옆에 붙인다 — 채널이 둘이라 설명 없이는 구분이 안 된다. */
const DIMENSION_HINTS: Record<SalesDimension, string> = {
  team: '자재마스터 DISPO 로 판정한 생산 CM × 카테고리입니다. 「주간 요약」 장표의 「팀별」과 같은 기준입니다.',
  salesChannel: '제품계층 2레벨로 판정한 영업 채널(B2C·B2B·수출·NPB/PB)입니다. 「주간 요약」 장표의 「채널별」과 같은 기준입니다.',
  channel: 'SAP 고객그룹1(KVGR1) 내역입니다 — 온라인·대형마트·CVS·SSM 처럼 파는 곳의 성격이고, 위의 「채널」과는 다른 축입니다.',
  brand: '제품계층 1레벨(브랜드)입니다.',
  matkl: 'SAP 자재그룹(MATKL) 내역입니다.',
  vkgrp: 'SAP 영업그룹(VKGRP) 내역입니다.',
};

const VTWEG_LABELS: Record<SalesVtweg, string> = {
  ALL: '전체',
  '10': '내수',
  '20': '수출',
};

/** 제품 구분 버튼의 설명. 자재코드 대역이 곧 기준이라 그 대역을 그대로 적는다. */
const SCOPE_HINTS: Record<SalesProductScope, string> = {
  ALL: '완제품·상품·기타를 모두 포함합니다.',
  FERT: '자재코드 5xxxxxxx — 직접 만들어 파는 완제품입니다.',
  HAWA: '자재코드 6xxxxxxx — 사서 파는 상품입니다.',
  ETC: '완제품·상품 대역 밖의 자재 판매입니다 — 포장재·부재료·원재료·반제품.',
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
  const scopeParam = getParam('scope', 'ALL') as SalesProductScope;
  const scope: SalesProductScope = SALES_SCOPE_KEYS.includes(scopeParam) ? scopeParam : 'ALL';
  const dimension = (getParam('dim', DEFAULT_DIMENSION) || DEFAULT_DIMENSION) as SalesDimension;
  const search = getParam('q', '');
  const page = getIntParam('page', 1);

  const searchInput = useKoreanInput(search, (value) => setParams({ q: value || null, page: null }));
  const [showBasis, setShowBasis] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['sales-report', from, to, vtweg, channel, scope],
    queryFn: () => getSalesReport({ from, to, vtweg, channel, scope }),
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
        row.brand.toLowerCase().includes(keyword) ||
        // 열로 보이는 값은 검색도 되어야 한다 — 「CM2 즉석밥」·「B2B」로 걸러 내려받는 흐름을 막지 않기 위한 것.
        row.team.toLowerCase().includes(keyword) ||
        row.channel.toLowerCase().includes(keyword),
    );
  }, [board, search]);

  const totalPages = Math.max(Math.ceil(filteredProducts.length / ROWS_PER_PAGE), 1);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const pageRows = filteredProducts.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  /**
   * 엑셀 내려받기 — **화면에 걸린 필터(제품 구분·검색)를 그대로 태운다.**
   * 페이지네이션은 태우지 않는다(보고 있는 15줄이 아니라 거른 전체가 파일이 되어야 한다).
   *
   * 화면에 없는 열(총매출액·차감·DISPO·제품계층)까지 싣는 것은 의도다 — 받아서 피벗할 때
   * 「이 줄이 왜 이 팀·이 채널인가」를 파일 안에서 되짚을 수 있어야 하기 때문이다.
   */
  const handleDownloadExcel = () => {
    exportToExcel(
      filteredProducts.map((row) => ({
        '자재코드': row.matnr,
        '제품명': row.name,
        '구분': SALES_SCOPE_LABELS[row.scope],
        '팀': row.team,
        'CM': row.cm,
        '카테고리': row.category,
        '채널': row.channel,
        '제품군': row.matkl,
        '브랜드': row.brand,
        '차감후 매출액(원)': Math.round(row.net),
        '총매출액(원)': Math.round(row.gross),
        '반품·조정 차감(원)': Math.round(row.deduction),
        '구성비(%)': Number(row.share.toFixed(3)),
        '수량': Math.round(row.qty),
        '전표건수': row.docs,
        // 분류 근거. 빈 값이면 자재마스터에 없다는 뜻이라 팀·채널이 「미분류」로 잡힌 줄이다.
        'DISPO': row.dispo,
        '제품계층2': row.lv2,
      })),
      `매출리포트_제품별_${SALES_SCOPE_LABELS[scope]}_${from}~${to}`,
    );
  };

  const applyPreset = (key: SalesPresetKey) => {
    // 프리셋을 고르면 직접 입력한 날짜는 지운다 — 둘이 동시에 살아 있으면 어느 쪽이 이겼는지 알 수 없다.
    setParams({ preset: key, from: null, to: null, page: null });
  };

  // 제품 구분을 좁히면 그 안에 없는 고객그룹은 목록에서 사라진다. 그런데 필터 값은 URL 에 남아
  // 조회에는 계속 걸리므로, 목록에 없는 값이면 한 줄 끼워 넣어 「무엇으로 걸러져 있는지」를 보이게 한다.
  const channelOptions = board?.ranks.channel.map((row) => row.key) ?? [];
  const channelSelectOptions =
    channel && !channelOptions.includes(channel) ? [channel, ...channelOptions] : channelOptions;

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
          <option value="">고객그룹 전체</option>
          {channelSelectOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <div className="h-5 w-px bg-neutral-200 mx-1" />

        {/*
          제품 구분 — 조회 자체를 좁힌다. 표만 거르면 상단 KPI·추이·구성비가 전체 모수로 남아
          「상품만」을 눌렀는데 합계는 안 변하는 화면이 된다.
        */}
        <div className="flex items-center gap-1">
          {SALES_SCOPE_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setParams({ scope: key === 'ALL' ? null : key, page: null })}
              title={SCOPE_HINTS[key]}
              className={`px-2.5 py-1.5 text-xs font-medium rounded border transition-colors ${
                scope === key
                  ? 'bg-[#E3F2FD] text-[#1565C0] border-[#1565C0]/30'
                  : 'text-neutral-600 border-neutral-200 hover:bg-neutral-100'
              }`}
            >
              {SALES_SCOPE_LABELS[key]}
            </button>
          ))}
          <InfoTooltip text="자재코드 대역으로 가릅니다 — 완제품 5xxxxxxx, 상품 6xxxxxxx, 기타는 그 밖(포장재·부재료·원재료·반제품 판매)입니다. 고른 구분이 화면 전체와 엑셀에 함께 걸립니다." size={13} />
        </div>
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
                <InfoTooltip text={DIMENSION_HINTS[dimension]} />
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  {DIMENSION_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => setParams({ dim: key === DEFAULT_DIMENSION ? null : key })}
                      title={DIMENSION_HINTS[key]}
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
              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 text-neutral-600">
                {SALES_SCOPE_LABELS[scope]}
              </span>
              <div className="relative ml-auto">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  {...searchInput}
                  placeholder="제품명 · 코드 · 제품군 · 브랜드 · 팀 · 채널 검색"
                  className="pl-8 pr-3 py-1.5 w-[280px] text-xs border border-neutral-200 rounded text-neutral-700 focus:outline-none focus:ring-1 focus:ring-[#1565C0]"
                />
              </div>
              <span className="text-xs text-neutral-500 tabular-nums">
                {filteredProducts.length.toLocaleString()}종
              </span>
              <button
                onClick={handleDownloadExcel}
                disabled={filteredProducts.length === 0}
                title="지금 걸린 제품 구분·검색 그대로, 보고 있는 쪽이 아니라 거른 전체를 내려받습니다"
                className="px-3 py-1.5 text-xs font-medium rounded border border-green-200 bg-white text-green-700 hover:bg-green-50 flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download size={13} /> 엑셀 다운로드
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-neutral-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium w-[90px]">코드</th>
                    <th className="px-4 py-2.5 text-left font-medium">제품명</th>
                    <th className="px-4 py-2.5 text-left font-medium w-[110px]">팀</th>
                    <th className="px-4 py-2.5 text-left font-medium w-[80px]">채널</th>
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
                      {/* 미분류는 흐리게 두되 숨기지 않는다 — 자재마스터에 DISPO·제품계층이 없다는 표시다. */}
                      <td className={`px-4 py-2.5 ${row.cm === '미분류' ? 'text-neutral-300' : 'text-neutral-600'}`}>
                        {row.team}
                      </td>
                      <td className={`px-4 py-2.5 ${row.channel === '미분류' ? 'text-neutral-300' : 'text-neutral-600'}`}>
                        {row.channel}
                      </td>
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
                      <td colSpan={9} className="px-4 py-12 text-center text-neutral-400">
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
