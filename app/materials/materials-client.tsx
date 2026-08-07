'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Info, Layers,
  Link2, PackageX, Search, SlidersHorizontal, TrendingUp, X,
} from 'lucide-react';
import {
  getMaterialDetail,
  type MaterialDetailPayload,
  type MaterialInsightPayload,
} from '@/actions/material-insight-actions';
import { FILTERABLE_MATERIAL_CLASSES, MATERIAL_CLASS_LABEL } from '@/lib/bom/explosion-sql';
import { exportToExcel } from '@/lib/excel-export';
import {
  classifyMaterialInventory,
  clampSimulationMonths,
  describeMaterialStatuses,
} from '@/lib/material/inventory-status';
import { UNASSIGNED_OWNER_ID, type MaterialInsight, type MaterialStockStatus } from '@/types/material';

const PLANT_NAME: Record<string, string> = {
  '1021': '1공장',
  '1022': '3공장',
  '1023': '2공장',
  '1031': '온라인물류',
};

const STATUS_ICON: Record<MaterialStockStatus, typeof Ban> = {
  ACTIVE: CheckCircle2,
  EXCESS: TrendingUp,
  SLOW_MOVING: Clock,
  OBSOLETE: PackageX,
};

const STATUS_TONE: Record<MaterialStockStatus, string> = {
  ACTIVE: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
  EXCESS: 'text-amber-700 bg-amber-50 ring-amber-200',
  SLOW_MOVING: 'text-orange-700 bg-orange-50 ring-orange-200',
  OBSOLETE: 'text-red-700 bg-red-50 ring-red-200',
};

const STATUS_ORDER: MaterialStockStatus[] = ['ACTIVE', 'EXCESS', 'SLOW_MOVING', 'OBSOLETE'];
const STATUS_SORT_ORDER: Record<MaterialStockStatus, number> = {
  OBSOLETE: 0,
  SLOW_MOVING: 1,
  EXCESS: 2,
  ACTIVE: 3,
};

const PAGE_SIZE = 30;

const won = (value: number) => `₩${Math.round(value).toLocaleString()}`;
const qty = (value: number) =>
  value >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(value < 10 ? 2 : 0);
const perUnitQty = (value: number) => {
  const absolute = Math.abs(value);
  const maximumFractionDigits =
    absolute === 0 || absolute >= 0.01
      ? 3
      : Math.min(9, Math.max(4, Math.ceil(-Math.log10(absolute)) + 1));
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits }).format(value);
};
const months = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}개월`);

function daysSince(iso: string | null) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

export default function MaterialsClient({
  payload,
  activeOwnerId,
  initialSearch = '',
}: {
  payload: MaterialInsightPayload;
  activeOwnerId: string | null;
  initialSearch?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<MaterialStockStatus | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [usageMonths, setUsageMonths] = useState(3);
  const [excessMonths, setExcessMonths] = useState(() =>
    clampSimulationMonths(payload.thresholds.excessMonths),
  );
  const [page, setPage] = useState(1);
  const [showCriteria, setShowCriteria] = useState(false);
  const [detail, setDetail] = useState<MaterialDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const buildAgeDays = daysSince(payload.build?.finishedAt ?? payload.build?.startedAt ?? null);
  const stale = buildAgeDays !== null && buildAgeDays > 14;
  const criteria = useMemo(
    () => describeMaterialStatuses({ usageMonths, excessMonths }),
    [usageMonths, excessMonths],
  );

  // 자재 구분별 건수 — 필터 칩에 그대로 띄운다.
  const classCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const insight of payload.insights) {
      counts.set(insight.materialClass, (counts.get(insight.materialClass) ?? 0) + 1);
    }
    return counts;
  }, [payload.insights]);

  // 위험 카드 수치는 자재 구분 필터를 반영한다 — "포장재만 볼 때의 과잉 금액"이 나와야 한다.
  const classScoped = useMemo(
    () =>
      classFilter
        ? payload.insights.filter((insight) => insight.materialClass === classFilter)
        : payload.insights,
    [payload.insights, classFilter],
  );

  const classified = useMemo(
    () =>
      classScoped.map((insight) => ({
        insight,
        result: classifyMaterialInventory(insight, { usageMonths, excessMonths }),
      })),
    [classScoped, usageMonths, excessMonths],
  );

  const statusTotals = useMemo(() => {
    const totals: Record<MaterialStockStatus, { count: number; value: number }> = {
      ACTIVE: { count: 0, value: 0 },
      EXCESS: { count: 0, value: 0 },
      SLOW_MOVING: { count: 0, value: 0 },
      OBSOLETE: { count: 0, value: 0 },
    };
    for (const { result } of classified) {
      totals[result.status].count += 1;
      totals[result.status].value += result.statusValue;
    }
    return totals;
  }, [classified]);

  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return classified
      .filter(({ result }) => (statusFilter ? result.status === statusFilter : true))
      .filter(({ insight }) =>
        keyword
          ? insight.materialCode.toLowerCase().includes(keyword) ||
            insight.materialName.toLowerCase().includes(keyword)
          : true,
      )
      .sort((a, b) => {
        const status = STATUS_SORT_ORDER[a.result.status] - STATUS_SORT_ORDER[b.result.status];
        if (status !== 0) return status;
        return b.result.statusValue - a.result.statusValue;
      });
  }, [classified, statusFilter, search]);

  // 필터가 바뀌면 첫 페이지로. 안 그러면 3페이지를 보던 중 필터를 바꿨을 때 빈 화면이 뜬다.
  // effect 로 되돌리면 한 번 잘못 그린 뒤에 다시 그리게 되므로 렌더 중에 맞춘다
  // (React 가 권장하는 "props 가 바뀔 때 state 조정" 패턴).
  const filterKey = `${statusFilter}|${classFilter}|${usageMonths}|${excessMonths}|${search}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openDetail = (insight: MaterialInsight) => {
    setDetailLoading(true);
    setDetail(null);
    getMaterialDetail(insight.materialCode, insight.werks)
      .then(setDetail)
      .finally(() => setDetailLoading(false));
  };

  const changeOwner = (ownerId: string) => {
    const query = ownerId === '__all__' ? '?scope=ALL' : `?owner=${encodeURIComponent(ownerId)}`;
    startTransition(() => router.push(`/materials${query}`));
  };

  const handleExport = () => {
    exportToExcel(
      rows.map(({ insight: row, result }) => ({
        자재코드: row.materialCode,
        자재명: row.materialName,
        자재구분: MATERIAL_CLASS_LABEL[row.materialClass] ?? row.materialClass,
        공장: PLANT_NAME[row.werks] ?? row.werks,
        재고상태: criteria[result.status].label,
        판정사유: result.reason,
        BOM등록: row.bomRegistered ? '등록' : '미등록',
        전용공용: row.kind === 'DEDICATED' ? '전용' : '공용',
        담당자: row.owners.map((o) => `${o.ownerName}(${Math.round(o.share * 100)}%)`).join(', '),
        가용재고: row.onHand,
        품질검사재고: row.qualityStock,
        보류재고: row.blockedStock,
        단위: row.unit,
        재고금액: Math.round(row.stockValue),
        귀속금액: Math.round(row.owners[0]?.allocatedValue ?? 0),
        사용이력기간개월: usageMonths,
        기간소요량: Math.round(result.usage),
        월평균소요: Math.round(result.monthlyUse),
        과잉기준개월: excessMonths,
        예상소요량: Math.round(result.expectedUse),
        재고월수: result.stockMonths === null ? '' : Number(result.stockMonths.toFixed(1)),
        미입고발주수량: row.openPoQty,
        미입고발주금액: Math.round(row.openPoValue),
        납기경과건: row.overduePoCount,
        사용완제품수: row.productCount,
        데이터경고: row.dataWarnings.join(' / '),
      })),
      '자재연결_귀속현황',
    );
  };

  if (!payload.success) {
    return (
      <div className="mx-auto max-w-3xl rounded border border-amber-200 bg-amber-50 p-8">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-700">
          <Link2 className="h-4 w-4" /> 자재 연결
        </div>
        <h1 className="mt-2 text-xl font-bold text-neutral-950">아직 볼 수 있는 데이터가 없습니다</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-700">{payload.message}</p>
        {payload.isAdmin ? (
          <Link
            href="/admin/bom"
            className="mt-4 inline-flex rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
          >
            BOM 마트 재빌드로 이동
          </Link>
        ) : null}
      </div>
    );
  }

  const summary = payload.summary;
  const n = usageMonths;
  const summaryOwnerId = activeOwnerId ?? payload.viewerOwnerId;
  const simulatedRiskValue = classified.reduce((total, { insight, result }) => {
    if (result.status === 'ACTIVE') return total;
    const share = summaryOwnerId
      ? (insight.owners.find((owner) => owner.ownerId === summaryOwnerId)?.share ?? 0)
      : 1;
    return total + result.statusValue * share;
  }, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-500">
            <Link2 className="h-4 w-4" /> 자재 연결
          </div>
          <h1 className="mt-1 text-2xl font-bold text-neutral-950">내 제품이 쓰는 원부포장재</h1>
          <p className="mt-1 text-sm text-neutral-600">
            담당 제품 → BOM 전개 → 그 제품을 만드는 자재의 재고·발주까지 이어서 봅니다.
            사용 이력과 예상 소요 기간을 3~12개월로 바꾸면 서버 재조회 없이 즉시 재분류됩니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeOwnerId ?? (payload.viewerOwnerId ?? '__all__')}
            onChange={(event) => changeOwner(event.target.value)}
            className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="__all__">전체 보기</option>
            {payload.ownerOptions.map((option) => (
              <option key={option.ownerId} value={option.ownerId}>
                {option.ownerName} ({option.materialCount})
                {option.ownerId === payload.viewerOwnerId ? ' · 나' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Download className="h-4 w-4" /> 엑셀
          </button>
        </div>
      </header>

      {stale ? (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          BOM 데이터가 {buildAgeDays}일 전 것입니다. 신제품·포장 변경이 반영되지 않았을 수 있습니다.
          {payload.isAdmin ? (
            <Link href="/admin/bom" className="font-semibold underline">
              재빌드
            </Link>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-neutral-200 bg-white p-4">
            <div className="text-xs font-semibold text-neutral-500">귀속 자재 재고금액</div>
            <div className="mt-1 text-2xl font-bold text-neutral-950">{won(summary.totalValue)}</div>
            {/* 전용과 공용배분을 반드시 나눠서 보여준다. 합쳐서 한 숫자로만 보여주면
                공용 배분분에 대해 "내 탓 아니다"가 나오고 화면 신뢰가 무너진다. */}
            <div className="mt-2 text-xs text-neutral-600">
              전용 {won(summary.dedicatedValue)} · 공용배분 {won(summary.sharedValue)}
            </div>
          </div>
          <div className="rounded border border-neutral-200 bg-white p-4">
            <div className="text-xs font-semibold text-neutral-500">연결 자재</div>
            <div className="mt-1 text-2xl font-bold text-neutral-950">
              {summary.materialCount.toLocaleString()}
              <span className="ml-1 text-sm font-medium text-neutral-500">종</span>
            </div>
            <div className="mt-2 text-xs text-neutral-600">담당 지분은 기준정보 설정값으로 배분</div>
          </div>
          <div className="rounded border border-neutral-200 bg-white p-4">
            <div className="text-xs font-semibold text-neutral-500">미입고 발주 (내 몫)</div>
            <div className="mt-1 text-2xl font-bold text-neutral-950">{won(summary.openPoValue)}</div>
            <div className="mt-2 text-xs text-neutral-600">발주했지만 아직 안 들어온 금액</div>
          </div>
          <div className="rounded border border-neutral-200 bg-white p-4">
            <div className="text-xs font-semibold text-neutral-500">시뮬레이션 위험금액</div>
            <div className="mt-1 text-2xl font-bold text-red-600">
              {won(simulatedRiskValue)}
            </div>
            <div className="mt-2 text-xs text-neutral-600">과잉·부진·불용 재고 귀속분</div>
          </div>
        </section>
      ) : null}

      <section className="rounded border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-neutral-800">
          <SlidersHorizontal className="h-4 w-4" /> 재고 분류 시뮬레이션
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <SimulationSlider
            label="사용 이력 판정 (N)"
            value={usageMonths}
            onChange={setUsageMonths}
            description={`최근 ${usageMonths}개월 MB51 생산투입(261-262)으로 정상/부진을 나눕니다.`}
          />
          <SimulationSlider
            label="과잉 기준 예상 소요 (M)"
            value={excessMonths}
            onChange={setExcessMonths}
            description={`현재고가 향후 ${excessMonths}개월 예상 소요를 넘으면 과잉입니다.`}
          />
        </div>
        <div className="mt-3 text-[11px] text-neutral-500">
          사용량 = MB51 생산투입 261 - 취소 262 순사용량. 품질검사재고는 불용으로 단정하지 않고 별도 표시합니다.
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATUS_ORDER.map((status) => {
          const meta = criteria[status];
          const Icon = STATUS_ICON[status];
          const total = statusTotals[status];
          const active = statusFilter === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(active ? null : status)}
              className={`rounded border p-4 text-left transition ${
                active
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <div
                  className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ring-1 ${
                    active ? 'bg-white/10 text-white ring-white/20' : STATUS_TONE[status]
                  }`}
                >
                  <Icon className="h-3 w-3" /> {meta.label}
                </div>
                <span className={`text-xs ${active ? 'text-white/70' : 'text-neutral-500'}`}>
                  {total.count}건
                </span>
              </div>
              <div className="mt-2 text-lg font-bold tabular-nums">{won(total.value)}</div>
              {/* 판정식을 숫자로 그대로 노출한다. "왜 위험으로 잡혔나"를 화면에서 답해야 한다. */}
              <div
                className={`mt-1.5 text-[11px] leading-4 ${active ? 'text-white/75' : 'text-neutral-500'}`}
              >
                {meta.formula}
              </div>
            </button>
          );
        })}
      </section>

      <section className="rounded border border-neutral-200 bg-white">
        <button
          type="button"
          onClick={() => setShowCriteria((value) => !value)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-neutral-700"
        >
          <Info className="h-4 w-4 text-neutral-400" />
          판정 기준 자세히 {showCriteria ? '접기' : '보기'}
        </button>
        {showCriteria ? (
          <div className="grid gap-3 border-t border-neutral-200 p-4 md:grid-cols-2">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="rounded bg-neutral-50 p-3">
                <div
                  className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_TONE[status]}`}
                >
                  {criteria[status].label}
                </div>
                <div className="mt-2 font-mono text-[12px] leading-5 text-neutral-800">
                  {criteria[status].formula}
                </div>
                <p className="mt-1.5 text-xs leading-5 text-neutral-600">{criteria[status].detail}</p>
              </div>
            ))}
            <div className="rounded bg-neutral-50 p-3 md:col-span-2">
              <div className="text-xs font-semibold text-neutral-700">공통 정의</div>
              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-neutral-600">
                <li>
                  · <strong>소요량</strong> = 최근 {n}개월 MB51 생산투입(261) - 취소(262) 순사용량입니다.
                  생산오더 실적 누락 여부와 관계없이 실제 자재 이동을 기준으로 계산합니다.
                </li>
                <li>
                  · <strong>월평균소요</strong> = 소요량 ÷ {n}. 현재고와 월평균소요 × {excessMonths}개월을
                  비교해 정상/과잉을 나눕니다.
                </li>
                <li>
                  · <strong>귀속</strong>: 담당자가 한 명이면 전용(100%), 여럿이면 기준정보의 최근{' '}
                  {payload.thresholds.usageLookbackMonths}개월 소요비중으로 나눕니다.
                </li>
                <li>
                  · <strong>불용 판정</strong>: BOM 미등록 또는 가용·품질검사재고 없이 SAP 보류재고만
                  있는 경우입니다. 품질검사재고는 합격 가능성이 있어 자동 불용 처리하지 않습니다.
                </li>
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setClassFilter(null)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                classFilter === null
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              전체 {payload.insights.length.toLocaleString()}
            </button>
            {FILTERABLE_MATERIAL_CLASSES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setClassFilter(classFilter === code ? null : code)}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                  classFilter === code
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {MATERIAL_CLASS_LABEL[code]} {(classCounts.get(code) ?? 0).toLocaleString()}
              </button>
            ))}
            {statusFilter ? (
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                className="ml-1 rounded bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200"
              >
                {criteria[statusFilter].label} ✕
              </button>
            ) : null}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="자재코드 · 자재명"
              className="w-56 rounded border border-neutral-300 py-2 pl-8 pr-3 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">자재</th>
                <th className="px-3 py-2 text-left font-semibold">구분</th>
                <th className="px-3 py-2 text-left font-semibold">공장</th>
                <th className="px-3 py-2 text-left font-semibold">담당</th>
                <th className="px-3 py-2 text-right font-semibold">재고</th>
                <th className="px-3 py-2 text-right font-semibold">판정금액</th>
                <th className="px-3 py-2 text-right font-semibold">재고월수</th>
                <th className="px-3 py-2 text-right font-semibold">미입고발주</th>
                <th className="px-3 py-2 text-right font-semibold">쓰는 제품</th>
                <th className="px-3 py-2 text-left font-semibold">재고상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-neutral-500">
                    조건에 맞는 자재가 없습니다.
                  </td>
                </tr>
              ) : (
                pageRows.map(({ insight: row, result }) => (
                  <tr
                    key={`${row.werks}|${row.materialCode}`}
                    onClick={() => openDetail(row)}
                    className="cursor-pointer text-neutral-800 hover:bg-neutral-50"
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium">{row.materialName || row.materialCode}</div>
                      <div className="text-xs text-neutral-500">{row.materialCode}</div>
                      {row.dataWarnings.length > 0 ? (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-700">
                          <AlertTriangle className="h-3 w-3" /> {row.dataWarnings[0]}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">
                      {MATERIAL_CLASS_LABEL[row.materialClass] ?? row.materialClass}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {PLANT_NAME[row.werks] ?? row.werks}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          !row.bomRegistered
                            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                            : row.kind === 'DEDICATED'
                              ? 'bg-neutral-900 text-white'
                              : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {!row.bomRegistered ? 'BOM 미등록' : row.kind === 'DEDICATED' ? '전용' : '공용'}
                      </span>
                      {row.owners[0] && row.owners[0].ownerId !== UNASSIGNED_OWNER_ID ? (
                        <div className="mt-0.5 text-[11px] text-neutral-500">
                          {row.owners[0].ownerName}
                          {row.owners.length > 1 || row.owners[0].share < 0.999
                            ? ` ${Math.round(row.owners[0].share * 100)}%`
                            : ''}
                          {row.owners.length > 1 ? ` 외 ${row.owners.length - 1}인` : ''}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-amber-600">담당 미지정</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {qty(row.onHand)}
                      <span className="ml-1 text-xs text-neutral-400">{row.unit}</span>
                      {row.qualityStock > 0 ? (
                        <div className="text-[11px] text-purple-600">품질 {qty(row.qualityStock)}</div>
                      ) : null}
                      {row.blockedStock > 0 ? (
                        <div className="text-[11px] text-red-600">보류 {qty(row.blockedStock)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{won(result.statusValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {months(result.stockMonths)}
                      <div className="text-[11px] text-neutral-500">
                        예상 {qty(result.expectedUse)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.openPoQty > 0 ? (
                        <>
                          <div>{won(row.openPoValue)}</div>
                          {row.overduePoCount > 0 ? (
                            <div className="text-[11px] text-red-600">
                              납기경과 {row.overduePoCount}건
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.productCount}</td>
                    <td className="px-3 py-2">
                      <span
                        title={`${criteria[result.status].formula} · ${result.reason}`}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_TONE[result.status]}`}
                      >
                        {criteria[result.status].label}
                      </span>
                      <div className="mt-1 max-w-52 text-[11px] leading-4 text-neutral-500">
                        {result.reason}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 text-sm text-neutral-600">
          <div>
            전체 {rows.length.toLocaleString()}건 중{' '}
            {rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, rows.length)}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page === 1}
              className="rounded p-1 hover:bg-neutral-100 disabled:opacity-30"
              aria-label="이전 페이지"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={page >= totalPages}
              className="rounded p-1 hover:bg-neutral-100 disabled:opacity-30"
              aria-label="다음 페이지"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {(detail || detailLoading) && (
        <MaterialDetailSheet
          detail={detail}
          loading={detailLoading}
          onClose={() => {
            setDetail(null);
            setDetailLoading(false);
          }}
        />
      )}
    </div>
  );
}

function SimulationSlider({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  description: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-xs font-semibold text-neutral-700">
        {label}
        <strong className="rounded bg-neutral-900 px-2 py-0.5 text-sm text-white">{value}개월</strong>
      </span>
      <input
        type="range"
        min={3}
        max={12}
        step={1}
        value={value}
        onChange={(event) => onChange(clampSimulationMonths(Number(event.target.value)))}
        onInput={(event) =>
          onChange(clampSimulationMonths(Number((event.currentTarget as HTMLInputElement).value)))
        }
        className="mt-3 w-full accent-neutral-900"
        aria-label={label}
      />
      <span className="mt-2 flex items-center justify-between gap-1">
        {[3, 6, 9, 12].map((months) => (
          <button
            key={months}
            type="button"
            onClick={() => onChange(months)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold transition ${
              value === months
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
            }`}
            aria-label={`${label} ${months}개월`}
          >
            {months}개월
          </button>
        ))}
      </span>
      <span className="mt-1 block text-[11px] leading-4 text-neutral-500">{description}</span>
    </label>
  );
}

function MaterialDetailSheet({
  detail,
  loading,
  onClose,
}: {
  detail: MaterialDetailPayload | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const entries = detail?.entries ?? [];

  // 다른 자재를 열면 1페이지부터. 위와 같은 이유로 렌더 중에 맞춘다.
  const [lastCode, setLastCode] = useState(detail?.materialCode);
  if (lastCode !== detail?.materialCode) {
    setLastCode(detail?.materialCode);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const pageEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-[800px] overflow-y-auto bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between border-b border-neutral-200 bg-white px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-500">
              <Layers className="h-3.5 w-3.5" /> 역전개 — 이 자재를 쓰는 완제품
            </div>
            <h2 className="mt-1 text-lg font-bold text-neutral-950">
              {detail?.materialName || detail?.materialCode || '불러오는 중…'}
            </h2>
            {detail ? (
              <div className="mt-1 text-sm text-neutral-600">
                {detail.materialCode} · {PLANT_NAME[detail.werks] ?? detail.werks} · 재고{' '}
                <strong className="tabular-nums">{qty(detail.onHand)}</strong> {detail.unit} ·
                완제품 {entries.length.toLocaleString()}종
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-neutral-100">
            <X className="h-5 w-5 text-neutral-500" />
          </button>
        </div>

        <div className="px-6 py-4">
          {/* 이 문장이 없으면 회의에서 오판이 난다. 공용 자재는 여러 제품이 나눠 쓴다. */}
          <div className="rounded border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs leading-5 text-sky-900">
            <strong>생산가능수량</strong>은 이 자재를 <strong>해당 완제품 하나에만 전량 투입</strong>했을
            때의 값입니다. 여러 제품이 나눠 쓰는 공용 자재라면 실제로는 이보다 적습니다.
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-neutral-500">불러오는 중…</div>
          ) : !entries.length ? (
            <div className="py-16 text-center text-sm text-neutral-500">
              이 자재를 쓰는 완제품을 찾지 못했습니다.
            </div>
          ) : (
            <>
              <table className="mt-4 w-full text-sm">
                <thead className="bg-neutral-50 text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">완제품</th>
                    <th className="px-3 py-2 text-left font-semibold">담당</th>
                    <th className="px-3 py-2 text-right font-semibold">개당 소요</th>
                    <th className="px-3 py-2 text-right font-semibold">생산가능</th>
                    <th className="px-3 py-2 text-right font-semibold">최근 생산</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pageEntries.map((entry) => (
                    <tr key={entry.rootMatnr} className="text-neutral-800">
                      <td className="px-3 py-2">
                        <Link
                          href={`/product/${entry.rootMatnr}`}
                          className="font-medium text-[#1565C0] hover:underline"
                        >
                          {entry.rootName || entry.rootMatnr}
                        </Link>
                        <div className="text-xs text-neutral-500">
                          {entry.rootMatnr}
                          {entry.rootFamily ? ` · ${entry.rootFamily}` : ''}
                        </div>
                        {/* 반제품을 거쳐 들어가는 경로 — "A자재 → □반제품 → ○완제품" */}
                        {entry.minLevel > 1 ? (
                          <div className="mt-0.5 text-[11px] text-neutral-500">
                            경유: {entry.viaPaths.join(' / ')}
                          </div>
                        ) : null}
                        {entry.warning ? (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> {entry.warning}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-600">{entry.ownerName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {perUnitQty(entry.qtyPerFg)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {entry.buildable === null ? (
                          <span className="text-neutral-300">—</span>
                        ) : (
                          `${entry.buildable.toLocaleString()}개`
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                        {entry.recentProduced > 0 ? `${qty(entry.recentProduced)} EA` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totalPages > 1 ? (
                <div className="mt-3 flex items-center justify-center gap-3 text-sm text-neutral-600">
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={page === 1}
                    className="rounded p-1 hover:bg-neutral-100 disabled:opacity-30"
                    aria-label="이전 페이지"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    disabled={page >= totalPages}
                    className="rounded p-1 hover:bg-neutral-100 disabled:opacity-30"
                    aria-label="다음 페이지"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
