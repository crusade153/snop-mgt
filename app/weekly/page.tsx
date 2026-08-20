// app/weekly/page.tsx
// 주간 완제품 재고 요약장표 — 수기 엑셀 「1. 완제품 재고현황」을 대체한다.
// 계산은 lib/weekly/board.ts 순수 함수에 있고 여기서는 표시·필터만 한다.
// 데이터는 주 1회 적재된 Supabase 스냅샷에서만 온다(BigQuery 를 때리지 않는다).
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, DatabaseZap, RefreshCw } from 'lucide-react';
import { captureWeeklySnapshotAction, getWeeklyBoard } from '@/actions/weekly-actions';
import CanvasStackedBarChart from '@/components/charts/canvas-stacked-bar-chart';
import InfoTooltip from '@/components/info-tooltip';
import {
  WEEKLY_BUCKET_KEYS,
  WEEKLY_BUCKET_LABELS,
  formatNoteAmount,
  toEok,
  type WeeklyBuckets,
} from '@/lib/weekly/board';
import { WEEKLY_DEFAULT_SCOPES } from '@/lib/weekly/classification';

/**
 * 구간 색 — 왼쪽(임박)이 붉고 오른쪽(안전)이 푸르다. 원본 엑셀 차트와 같은 방향이다.
 *
 * ⚠️ **안전 구간(75% 이상)은 일부러 채도를 낮췄다.** 다섯 색이 모두 진하면 재고금액의 절반을 차지하는
 * 파란 조각이 시선을 먼저 가져가서 "어디가 문제인가"가 늦게 읽힌다. 위험 두 구간만 진하게 둔다.
 */
const BUCKET_COLORS: Record<keyof WeeklyBuckets, string> = {
  under50: '#D32F2F',
  r50_70: '#F57C00',
  r70_75: '#FBC02D',
  r75_85: '#81C784',
  over85: '#90CAF9',
};

/** 소진이 필요한 구간. 표·차트·요약 모두 이 정의 하나를 쓴다. */
const RISK_BUCKET_KEYS: (keyof WeeklyBuckets)[] = ['under50', 'r50_70'];

/** 위험 구간 열에 얹는 옅은 배경 — 숫자를 가리지 않을 만큼만 */
const BUCKET_CELL_TONE: Record<keyof WeeklyBuckets, string> = {
  under50: 'bg-[#FFF5F5] text-[#C62828] font-semibold',
  r50_70: 'bg-[#FFF8F0] text-[#E65100]',
  r70_75: 'text-neutral-600',
  r75_85: 'text-neutral-400',
  over85: 'text-neutral-400',
};

type MoneyUnit = 'million' | 'won';

/**
 * 적재 시각 표기(KST).
 *
 * `/stock` 은 실시간이고 이 장표는 적재 순간에 고정된다. 두 화면의 재고금액이 다를 때
 * 사용자가 가장 먼저 확인해야 하는 것이 "언제 찍은 값인가" 라서 제목 옆에 붙여 둔다.
 */
function capturedLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function WeeklyBoardPage() {
  const [weekEnd, setWeekEnd] = useState<string | undefined>(undefined);
  const [unit, setUnit] = useState<MoneyUnit>('million');
  const [isAdmin, setIsAdmin] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  // 스코프는 고정이다 — `/stock` 의 「통합 재고」(플랜트+물류)와 같은 정의여야 두 화면의 금액이 맞는다.
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['weekly-board', weekEnd ?? 'latest'],
    queryFn: () => getWeeklyBoard(weekEnd, [...WEEKLY_DEFAULT_SCOPES]),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  // 적재 버튼은 관리자에게만 보인다. 실제 권한은 서버 액션이 다시 확인한다.
  useEffect(() => {
    let active = true;
    fetch('/api/admin/status', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { isAdmin: false }))
      .then((payload) => {
        if (active) setIsAdmin(Boolean(payload.isAdmin));
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCapture = async () => {
    setCapturing(true);
    setCaptureMessage(null);
    try {
      const result = await captureWeeklySnapshotAction(weekEnd);
      setCaptureMessage(result.message);
      if (result.ok) await refetch();
    } finally {
      setCapturing(false);
    }
  };

  const board = data?.board ?? null;
  const hasPrevious = board?.hasPrevious ?? false;

  /** 금액 표기. 백만원 모드는 자릿수를 줄여 한 화면에 열을 더 넣기 위한 것이다. */
  const money = (value: number) =>
    unit === 'million'
      ? Math.round(value / 1_000_000).toLocaleString('ko-KR')
      : Math.round(value).toLocaleString('ko-KR');

  /** 전주 스냅샷이 없으면 0 을 실제 값처럼 보여주지 않는다. */
  const moneyOrDash = (value: number, available = true) => (available ? money(value) : '-');

  const percent = (value: number | null) => (value === null ? '-' : `${Math.round(value * 100)}%`);

  /** 0 을 숫자로 쓰면 표가 0 으로 뒤덮여 실제 값이 묻힌다. */
  const moneyCell = (value: number) =>
    Math.round(value) === 0 ? <span className="text-neutral-300">-</span> : money(value);

  /** 소진이 필요한 구간(50% 미만 + 50~70%)의 금액과 비중 */
  const riskOf = (buckets: WeeklyBuckets, stockValue: number) => {
    const value = RISK_BUCKET_KEYS.reduce((sum, key) => sum + (buckets[key] || 0), 0);
    return { value, ratio: stockValue > 0 ? value / stockValue : 0 };
  };

  const chartSeries = useMemo(() => {
    if (!board) return [];
    return WEEKLY_BUCKET_KEYS.map((key) => ({
      label: WEEKLY_BUCKET_LABELS[key],
      color: BUCKET_COLORS[key],
      emphasis: RISK_BUCKET_KEYS.includes(key),
      values: board.categoryBuckets.map((entry) => toEok(entry.buckets[key])),
    }));
  }, [board]);

  return (
    <div className="p-3 lg:p-5 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-neutral-900">
            1. {data?.labels.title || '완제품 재고현황'}
          </h1>
          <span className="text-[11px] text-neutral-400">
            {unit === 'million' ? '백만원' : '원'}
          </span>
          <InfoTooltip
            text={
              '주 = 월~일, 재고 기준일 = 일요일 마감. 재고는 소급 계산이 불가능해 적재한 값만 남습니다. ' +
              '재고·출고·생산 금액은 모두 원가팀 기말재고 단가(없으면 최대 6개월 과거월) 기준입니다. ' +
              '재고 범위·단가·플랜트 판정이 재고 통합 장표(/stock)의 통합 재고와 동일하므로 ' +
              '적재 시점에는 두 화면의 재고금액이 원 단위까지 같습니다. ' +
              '이후 벌어지는 차이는 통합 장표가 실시간, 이 장표가 적재 시점 고정이라서 생기는 시간차입니다.'
            }
          />
          {data?.capturedAt && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              적재 {capturedLabel(data.capturedAt)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* 단위 전환 */}
          <div className="flex overflow-hidden rounded-md border border-neutral-200">
            {(['million', 'won'] as MoneyUnit[]).map((value) => (
              <button
                key={value}
                onClick={() => setUnit(value)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  unit === value
                    ? 'bg-[#1565C0] text-white'
                    : 'bg-white text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {value === 'million' ? '백만' : '원'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1.5">
            <CalendarDays size={13} className="text-neutral-500" />
            <select
              value={weekEnd ?? data?.weekEnd ?? ''}
              onChange={(event) => setWeekEnd(event.target.value || undefined)}
              className="bg-transparent text-xs font-medium text-neutral-800 outline-none"
              disabled={!data?.weeks.length}
            >
              {(data?.weeks ?? []).map((week) => (
                <option key={week} value={week}>
                  {week}
                </option>
              ))}
              {!data?.weeks.length && <option value="">주차 없음</option>}
            </select>
          </div>

          <button
            onClick={() => refetch()}
            title="새로고침"
            className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw size={13} className={isRefetching ? 'animate-spin' : ''} />
          </button>

          {isAdmin && (
            <button
              onClick={handleCapture}
              disabled={capturing}
              title="이 주차를 지금 적재합니다"
              className="flex items-center gap-1 rounded-md border border-[#1565C0]/30 bg-[#E3F2FD] px-2.5 py-1.5 text-xs font-medium text-[#1565C0] hover:bg-[#BBDEFB] disabled:opacity-50"
            >
              <DatabaseZap size={13} className={capturing ? 'animate-pulse' : ''} />
              {capturing ? '적재 중' : '적재'}
            </button>
          )}
        </div>
      </header>

      {captureMessage && (
        <p className="rounded-md border border-[#1565C0]/20 bg-[#E3F2FD] px-2.5 py-1.5 text-[11px] text-[#1565C0]">
          {captureMessage}
        </p>
      )}

      {isLoading && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          불러오는 중…
        </div>
      )}

      {!isLoading && data && !data.board && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm font-medium text-neutral-700">
            {data.message || '아직 적재된 주차가 없습니다.'}
          </p>
          {isAdmin && (
            <p className="mt-2 text-xs text-[#1565C0]">
              위 <b>적재</b> 버튼으로 이번 주를 채울 수 있습니다.
            </p>
          )}
        </div>
      )}

      {board && (
        <>
          {/* 1. 메인 표 */}
          <section className="rounded-lg border border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_230px]">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-right text-xs">
                  <thead>
                    {/* 열이 13개다. 그룹 머리행이 없으면 어디까지가 흐름이고 어디부터가 구간인지 매번 세어야 한다. */}
                    <tr className="bg-neutral-100 text-[10px] text-neutral-500">
                      <th className="px-1.5 pt-1.5 text-center font-bold" colSpan={3} rowSpan={2}>
                        <span className="text-[11px] text-neutral-700">구분</span>
                      </th>
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 pt-1.5 text-center font-medium"
                        colSpan={3}
                      >
                        주간 흐름 <span className="text-neutral-400">{data?.labels.flow}</span>
                      </th>
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 pt-1.5 text-center font-medium"
                        colSpan={5}
                      >
                        소비기한 잔여율 구간별 재고금액
                      </th>
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 pt-1.5 text-center font-medium"
                        colSpan={3}
                      >
                        당주 재고
                      </th>
                    </tr>
                    <tr className="bg-neutral-100 text-[11px] text-neutral-700">
                      <th className="border-l border-neutral-200 px-1.5 pb-1.5 font-bold">
                        {data?.labels.previousStock}
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold">출고</th>
                      <th className="px-1.5 pb-1.5 font-bold">생산</th>
                      {WEEKLY_BUCKET_KEYS.map((key, index) => (
                        <th
                          key={key}
                          className={`px-1.5 pb-1.5 font-bold ${index === 0 ? 'border-l border-neutral-200' : ''} ${
                            RISK_BUCKET_KEYS.includes(key) ? 'text-[#C62828]' : 'text-neutral-500'
                          }`}
                        >
                          {WEEKLY_BUCKET_LABELS[key].split(' [')[0]}
                          <br />
                          <span className="font-normal text-neutral-400">
                            [{WEEKLY_BUCKET_LABELS[key].split('[')[1]}
                          </span>
                        </th>
                      ))}
                      <th className="border-l border-neutral-200 px-1.5 pb-1.5 font-bold">
                        {data?.labels.currentStock}
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold">
                        <span className="flex items-center justify-end gap-1">
                          소진 필요
                          <InfoTooltip text="소비기한 잔여율 70% 미만(50% 미만 + 50~70%) 재고금액과 그 비중입니다. 이 비중이 높은 행부터 소진 계획이 필요합니다." />
                        </span>
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold">
                        <span className="flex items-center justify-end gap-1">
                          월 출고 比
                          <InfoTooltip text="재고금액 ÷ 당월 누적 출고금액입니다. 출고금액도 재고와 똑같이 완제품 재고단가로 환산하므로, 200% 는 '이번 달 출고량의 2배를 쌓아두고 있다'로 읽으면 됩니다. 매출액(판매가)이 분모였을 때는 마진율만큼 비율이 눌려 이렇게 읽을 수 없었습니다." />
                        </span>
                        재고금액
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.rows.map((row, index) => {
                      const risk = riskOf(row.buckets, row.stockValue);
                      // 생산 CM 행과 상품·미분류 행 사이에 선을 하나 넣어 성격이 다른 행임을 드러낸다.
                      const isAside = row.cm === '상품' || row.cm === '미분류';
                      const previousIsAside =
                        index > 0 &&
                        (board.rows[index - 1].cm === '상품' || board.rows[index - 1].cm === '미분류');
                      return (
                        <tr
                          key={`${row.cm}-${row.plant}-${row.category}`}
                          className={`border-b border-neutral-100 hover:bg-neutral-50 ${
                            isAside && !previousIsAside ? 'border-t-2 border-t-neutral-200' : ''
                          }`}
                        >
                          <td className="px-1.5 py-1.5 text-center font-medium">
                            {isAside ? (
                              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                                {row.cm}
                              </span>
                            ) : (
                              row.cm
                            )}
                          </td>
                          <td className="px-1.5 py-1.5 text-center text-neutral-500">{row.plant}</td>
                          <td className="px-1.5 py-1.5 text-center font-medium">{row.category}</td>
                          <td className="border-l border-neutral-100 px-1.5 py-1.5 tabular-nums text-neutral-500">
                            {hasPrevious ? moneyCell(row.previousStockValue) : '-'}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                            {moneyCell(row.shippedValue)}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                            {moneyCell(row.producedValue)}
                          </td>
                          {WEEKLY_BUCKET_KEYS.map((key, bucketIndex) => (
                            <td
                              key={key}
                              className={`px-1.5 py-1.5 tabular-nums ${BUCKET_CELL_TONE[key]} ${
                                bucketIndex === 0 ? 'border-l border-neutral-100' : ''
                              }`}
                            >
                              {moneyCell(row.buckets[key])}
                            </td>
                          ))}
                          <td className="border-l border-neutral-100 px-1.5 py-1.5 text-sm font-bold tabular-nums text-neutral-900">
                            {money(row.stockValue)}
                          </td>
                          <td className="px-1.5 py-1.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="font-semibold tabular-nums text-[#C62828]">
                                {moneyCell(risk.value)}
                              </span>
                              <span className="h-1.5 w-9 overflow-hidden rounded-sm bg-neutral-100">
                                <span
                                  className="block h-1.5 rounded-sm bg-[#D32F2F]"
                                  style={{ width: `${Math.min(100, Math.round(risk.ratio * 100))}%` }}
                                />
                              </span>
                              <span className="w-7 text-[10px] tabular-nums text-neutral-500">
                                {Math.round(risk.ratio * 100)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-600">
                            {percent(row.stockToShipmentRatio)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-[#FFF3E0] font-bold">
                      <td className="px-1.5 py-2 text-center" colSpan={3}>
                        합계
                      </td>
                      <td className="border-l border-neutral-200 px-1.5 py-2 tabular-nums">
                        {moneyOrDash(board.totals.previousStockValue, hasPrevious)}
                      </td>
                      <td className="px-1.5 py-2 tabular-nums">{money(board.totals.shippedValue)}</td>
                      <td className="px-1.5 py-2 tabular-nums">{money(board.totals.producedValue)}</td>
                      {WEEKLY_BUCKET_KEYS.map((key, bucketIndex) => (
                        <td
                          key={key}
                          className={`px-1.5 py-2 tabular-nums ${
                            RISK_BUCKET_KEYS.includes(key) ? 'text-[#C62828]' : 'text-neutral-600'
                          } ${bucketIndex === 0 ? 'border-l border-neutral-200' : ''}`}
                        >
                          {money(board.totals.buckets[key])}
                        </td>
                      ))}
                      <td className="border-l border-neutral-200 px-1.5 py-2 text-sm tabular-nums">
                        {money(board.totals.stockValue)}
                      </td>
                      <td className="px-1.5 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="tabular-nums text-[#C62828]">
                            {money(riskOf(board.totals.buckets, board.totals.stockValue).value)}
                          </span>
                          <span className="h-1.5 w-9 overflow-hidden rounded-sm bg-white">
                            <span
                              className="block h-1.5 rounded-sm bg-[#D32F2F]"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round(
                                    riskOf(board.totals.buckets, board.totals.stockValue).ratio * 100
                                  )
                                )}%`,
                              }}
                            />
                          </span>
                          <span className="w-7 text-[10px] font-normal tabular-nums text-neutral-500">
                            {Math.round(
                              riskOf(board.totals.buckets, board.totals.stockValue).ratio * 100
                            )}
                            %
                          </span>
                        </div>
                      </td>
                      <td className="px-1.5 py-2 tabular-nums">
                        {percent(board.totals.stockToShipmentRatio)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
                  <span>
                    생산 − 출고{' '}
                    <b className="tabular-nums text-neutral-700">
                      {money(board.totals.producedValue - board.totals.shippedValue)}
                    </b>
                  </span>
                  {hasPrevious && (
                    <span className="flex items-center gap-1">
                      대차 차이
                      <InfoTooltip text="전주 재고 + 생산 − 출고 와 당주 재고의 차이입니다. 폐기·반품·재평가가 섞여 0 이 되지 않는 것이 정상입니다." />
                      <b className="tabular-nums text-neutral-700">
                        {money(board.totals.balanceGap)}
                      </b>
                    </span>
                  )}
                  {data && data.unpricedItemCount > 0 && (
                    <span className="text-amber-700">단가 미확보 {data.unpricedItemCount}건</span>
                  )}
                </div>
              </div>

              <aside className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="mb-1 text-[10px] font-bold text-neutral-500">비고</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-neutral-700">
                  {data?.notes.stock}
                </pre>
              </aside>
            </div>
          </section>

          {/* 2. 차트 + 구간별 주간 재고변동 */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 text-xs font-bold text-neutral-800">
                카테고리별 소비기한별 재고금액
                <span className="ml-1.5 font-normal text-neutral-400">억원</span>
              </h2>
              {board.categoryBuckets.length > 0 ? (
                <CanvasStackedBarChart
                  labels={board.categoryBuckets.map((entry) => entry.category)}
                  series={chartSeries}
                  height={280}
                />
              ) : (
                <p className="py-10 text-center text-xs text-neutral-400">표시할 재고가 없습니다.</p>
              )}
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 text-xs font-bold text-neutral-800">
                소비기한 구간별 주간 재고변동
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-right text-xs">
                  <thead>
                    <tr className="bg-neutral-100 text-[11px] text-neutral-700">
                      <th className="px-1.5 py-1.5 text-center font-bold">구분</th>
                      {WEEKLY_BUCKET_KEYS.map((key) => (
                        <th key={key} className="px-1.5 py-1.5 font-bold">
                          {WEEKLY_BUCKET_LABELS[key].split(' [')[0]}
                        </th>
                      ))}
                      <th className="px-1.5 py-1.5 font-bold">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-neutral-100">
                      <td className="px-1.5 py-1.5 text-center font-medium">
                        {data?.labels.previousStock}
                      </td>
                      {WEEKLY_BUCKET_KEYS.map((key) => (
                        <td key={key} className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                          {moneyOrDash(board.movement.previous[key], hasPrevious)}
                        </td>
                      ))}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums text-neutral-500">
                        {moneyOrDash(board.movement.previousTotal, hasPrevious)}
                      </td>
                    </tr>
                    <tr className="border-b border-neutral-100">
                      <td className="px-1.5 py-1.5 text-center font-medium">
                        {data?.labels.currentStock}
                      </td>
                      {WEEKLY_BUCKET_KEYS.map((key) => (
                        <td key={key} className="px-1.5 py-1.5 tabular-nums">
                          {money(board.movement.current[key])}
                        </td>
                      ))}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums">
                        {money(board.movement.currentTotal)}
                      </td>
                    </tr>
                    <tr className="border-b border-neutral-100 bg-[#FFF8E1]">
                      <td className="px-1.5 py-1.5 text-center font-medium">전주 比 증감액</td>
                      {WEEKLY_BUCKET_KEYS.map((key) => (
                        <td
                          key={key}
                          className={`px-1.5 py-1.5 tabular-nums ${
                            !hasPrevious
                              ? 'text-neutral-400'
                              : board.movement.delta[key] < 0
                                ? 'text-[#C62828]'
                                : 'text-[#1565C0]'
                          }`}
                        >
                          {moneyOrDash(board.movement.delta[key], hasPrevious)}
                        </td>
                      ))}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums">
                        {moneyOrDash(board.movement.deltaTotal, hasPrevious)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-1.5 py-1.5 text-center font-medium">전주 比 증감률</td>
                      {WEEKLY_BUCKET_KEYS.map((key) => (
                        <td key={key} className="px-1.5 py-1.5 tabular-nums">
                          {hasPrevious ? `${(board.movement.rate[key] * 100).toFixed(1)}%` : '-'}
                        </td>
                      ))}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums">
                        {hasPrevious ? `${(board.movement.rateTotal * 100).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-neutral-200 bg-neutral-50 p-2.5 font-sans text-[11px] leading-relaxed text-neutral-700">
                {data?.notes.bucket}
              </pre>
            </section>
          </div>

          {/* 3. 카테고리 축에 못 담긴 재고 — 매핑 누락을 금액으로 드러낸다 */}
          {board.unmappedDispo.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <h2 className="mb-1.5 flex items-center gap-1 text-xs font-bold text-amber-900">
                <AlertTriangle size={13} />
                카테고리 미매핑 (DISPO)
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {board.unmappedDispo.slice(0, 12).map((entry) => (
                  <span
                    key={entry.dispo}
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900"
                  >
                    <b>{entry.dispo}</b> {formatNoteAmount(entry.value)} · {entry.itemCount}품목
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
