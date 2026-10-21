// app/weekly/page.tsx
// 주간 완제품 재고 요약장표 — 수기 엑셀 「1. 완제품 재고현황」을 대체한다.
// 계산은 lib/weekly/board.ts 순수 함수에 있고 여기서는 표시·필터만 한다.
// 데이터는 주 1회 적재된 Supabase 스냅샷에서만 온다(BigQuery 를 때리지 않는다).
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  DatabaseZap,
  Download,
  Info,
  Layers,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  captureWeeklySnapshotAction,
  getWeeklyBoard,
  getWeeklyCategoryDetail,
  getWeeklyChannelBoard,
  refreshMaterialHierarchyAction,
} from '@/actions/weekly-actions';
import CanvasStackedBarChart from '@/components/charts/canvas-stacked-bar-chart';
import SalesRankBars, { type RankBarItem } from '@/components/charts/sales-rank-bars';
import WeeklyFlowBridge from '@/components/charts/weekly-flow-bridge';
import { exportToExcel } from '@/lib/excel-export';
import InfoTooltip from '@/components/info-tooltip';
import {
  WEEKLY_BUCKET_KEYS,
  WEEKLY_BUCKET_LABELS,
  WEEKLY_RISK_BUCKET_KEYS,
  WEEKLY_UNDER50_KEYS,
  WEEKLY_UNDER50_LABELS,
  formatNoteAmount,
  formatSignedNoteAmount,
  isUnder50SplitComplete,
  toEok,
  type WeeklyBoardMetrics,
  type WeeklyBuckets,
  type WeeklyUnder50Key,
  type WeeklyUnder50Split,
} from '@/lib/weekly/board';
import type { WeeklyDetailRow } from '@/lib/weekly/board';
import type { WeeklyChannel } from '@/lib/weekly/channel';
import { isOverriddenMaterial } from '@/lib/weekly/category-overrides';
import {
  isMerchandiseMaterial,
  WEEKLY_DEFAULT_SCOPES,
  WEEKLY_STORAGE_SCOPE_LABELS,
  type WeeklyCategory,
  type WeeklyCm,
} from '@/lib/weekly/classification';
import { seoulToday } from '@/lib/weekly/week';

/**
 * 구간 색 — 왼쪽(임박)이 붉고 오른쪽(안전)이 푸르다. 원본 엑셀 차트와 같은 방향이다.
 *
 * ⚠️ **안전 구간(75% 이상)은 일부러 채도를 낮췄다.** 다섯 색이 모두 진하면 재고금액의 절반을 차지하는
 * 파란 조각이 시선을 먼저 가져가서 "어디가 문제인가"가 늦게 읽힌다. 75% 미만 위험 구간만 진하게 둔다.
 */
const BUCKET_COLORS: Record<keyof WeeklyBuckets, string> = {
  under50: '#D32F2F',
  r50_70: '#F57C00',
  r70_75: '#FBC02D',
  r75_85: '#81C784',
  over85: '#90CAF9',
};

/** 소진 기준은 집계 모듈의 단일 정의를 그대로 쓴다. */
const RISK_BUCKET_KEYS = WEEKLY_RISK_BUCKET_KEYS;

/** 위험 구간 열에 얹는 옅은 배경 — 숫자를 가리지 않을 만큼만 */
const BUCKET_CELL_TONE: Record<keyof WeeklyBuckets, string> = {
  under50: 'bg-[#FFF5F5] text-[#C62828] font-semibold',
  r50_70: 'bg-[#FFF8F0] text-[#E65100]',
  r70_75: 'bg-[#FFFDE7] text-[#F9A825]',
  r75_85: 'text-neutral-400',
  over85: 'text-neutral-400',
};

/**
 * 50% 미만 세부 구간 색 — 같은 빨강 계열에서 **임박할수록 진하게** 둔다.
 * 부모(50% 미만)와 같은 계열이라 「세 칸을 합치면 50% 미만」이 색으로 먼저 읽힌다.
 */
const UNDER50_COLORS: Record<WeeklyUnder50Key, string> = {
  under20: '#7F0000',
  r20_40: '#C62828',
  r40_50: '#EF5350',
};

const UNDER50_CELL_TONE: Record<WeeklyUnder50Key, string> = {
  under20: 'bg-[#FDECEA] text-[#7F0000] font-bold',
  r20_40: 'bg-[#FFF5F5] text-[#C62828] font-semibold',
  r40_50: 'bg-[#FFF5F5] text-[#E53935]',
};

/** 50% 미만을 뺀 나머지 4구간. 50% 미만 자리는 세부 3칸(또는 미분해 1칸)이 대신 그린다 */
const OTHER_BUCKET_KEYS = WEEKLY_BUCKET_KEYS.filter((key) => key !== 'under50');

const UNDER50_HINT =
  '소비기한 잔여율 50% 미만 [내부소진] 재고를 0~20% · 20~40% · 40~50% 로 나눈 재고금액입니다. ' +
  '세 칸의 합은 50% 미만과 원 단위까지 같습니다. 0~20% 에는 기한이 이미 지난 배치(잔여율 0 이하)도 들어갑니다. ' +
  '세부 구간은 2026-10 이후 적재분부터 있습니다 — 재고는 소급 계산이 불가능해 그 전 주차는 세 칸을 합쳐 50% 미만 하나로 보여줍니다.';

const UNDER50_ESTIMATE_HINT =
  '이 주차의 0~20 · 20~40 · 40~50% 는 세부 구간을 적재하기 전에 찍힌 값이라, 배치 이동 이력(MB51)으로 ' +
  '그 주 배치재고를 거꾸로 계산해 나눈 추정치입니다. 50% 미만 합계(저장값)는 그대로이고 그 안의 비율만 추정했습니다. ' +
  '역산 수량이 저장값과 5% 이내로 맞는 품목이 50% 미만 금액의 약 70% 이고, 물류센터 재고는 이동 이력이 없어 ' +
  '같은 품목·카테고리 비율을 빌려 썼습니다. 합계 수준에서 참고하고 품목 하나하나의 값은 오차가 클 수 있습니다.';

/** 「역산 추정」 표시. 실측과 추정을 사용자가 한눈에 구분하게 한다 */
function EstimateBadge({ label = '역산 추정' }: { label?: string }) {
  return (
    <span
      title={UNDER50_ESTIMATE_HINT}
      className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1 py-px text-[9px] font-bold text-amber-800"
    >
      {label}
    </span>
  );
}

type MoneyUnit = 'million' | 'won';

/**
 * 표를 접는 축.
 *
 * ⚠️ **두 축은 같은 주차·같은 스냅샷·같은 스코프를 본다.** 축만 다르게 묶는 것이라
 * 합계(재고·출고·생산·구간액)는 원 단위까지 같아야 한다 — 탭을 바꿨는데 총액이 달라지면
 * 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
 *   - team    = CM × 공장 × 카테고리 (DISPO 기준, 생산 조직)
 *   - channel = 판매 채널 (제품계층 LV2 기준)
 */
type BoardAxis = 'team' | 'channel';

const AXIS_TABS: { key: BoardAxis; label: string; hint: string }[] = [
  {
    key: 'team',
    label: '팀별',
    hint: 'MRP 관리자 코드(DISPO)로 판정한 CM × 공장 × 카테고리 축입니다. 생산 조직 기준입니다.',
  },
  {
    key: 'channel',
    label: '채널별',
    hint:
      '제품계층 2레벨(PRDHA_2_T)로 판정한 판매 채널 축입니다(B2C·B2B·수출·NPB/PB·기타). ' +
      '같은 재고를 다르게 묶은 것이라 합계는 팀별 탭과 정확히 같습니다.',
  },
];

/**
 * 펼친 칸. 축마다 좌표가 다르다.
 *
 * `all` 은 「전체보기」 — 카테고리·CM·채널을 하나도 걸지 않은 스코프 전체 SKU 목록이다.
 * 같은 스냅샷·같은 판정 함수로 접으므로 합계가 위 표의 합계행과 같고, 축을 바꿔도 모수가 그대로다.
 */
type Drill =
  | { axis: 'team'; cm: WeeklyCm | null; category: WeeklyCategory }
  | { axis: 'channel'; channel: WeeklyChannel }
  | { axis: 'all' };

const drillKey = (drill: Drill) =>
  drill.axis === 'all'
    ? 'all'
    : drill.axis === 'channel'
      ? `channel:${drill.channel}`
      : `team:${drill.cm ?? 'ALL'}:${drill.category}`;

const drillLabel = (drill: Drill) =>
  drill.axis === 'all'
    ? '전체'
    : drill.axis === 'channel'
      ? drill.channel
      : `${drill.cm ? `${drill.cm} · ` : ''}${drill.category}`;

const ALL_DRILL: Drill = { axis: 'all' };

/**
 * 표의 한 줄을 축과 무관하게 그리기 위한 표시용 행.
 *
 * 집계 값(`WeeklyBoardMetrics`)은 두 축이 같은 코어에서 나오므로 그대로 펼쳐 쓰고,
 * 축마다 다른 것은 **왼쪽 「구분」 칸 몇 개와 드릴다운 좌표뿐**이다.
 * 표를 축별로 두 벌 만들면 열 하나를 고칠 때마다 두 곳을 고쳐야 하고, 곧 어긋난다.
 */
type DisplayRow = WeeklyBoardMetrics & {
  key: string;
  /** 「구분」 열에 들어갈 셀들. 팀별 3칸(CM·공장·카테고리) / 채널별 1칸(채널) */
  groupCells: { text: string; tone: 'badge' | 'muted' | 'plain'; caret?: boolean }[];
  /** 생산 축 밖의 행(상품·미분류)인지. 위에 구분선을 넣는다 */
  showDivider: boolean;
  isOpen: boolean;
  title: string;
  drill: Drill;
};

/**
 * 상세표 정렬 축.
 *
 * ⚠️ `remain` 은 **소비기한 잔여 열이 채워진 주차에서만** 쓸 수 있다. 열이 추가되기 전에
 * 적재된 주차는 값이 null 인데, 그걸 0 으로 보고 정렬하면 기한없음 재고가 「오늘 폐기」로 맨 위에 온다.
 */
type DetailSortKey =
  | 'group'
  | 'stockValue'
  | 'critical'
  | 'riskValue'
  | 'riskRatio'
  | 'remain'
  | 'shipped'
  | 'ratio'
  | 'delta';

/**
 * `group` 은 「전체보기」에서만 쓴다 — 위 표의 행 순서(팀별 = CM·공장·카테고리, 채널별 = 채널)대로
 * 묶고 그 안에서 재고금액 순으로 늘어놓는다. 받은 엑셀이 위 표와 같은 순서로 읽히게 하기 위한 것이다.
 */
const DETAIL_SORTS: { key: DetailSortKey; label: string; hint: string }[] = [
  { key: 'group', label: '구분순', hint: '위 표의 행 순서대로 묶고, 그 안에서 재고금액이 큰 순' },
  { key: 'stockValue', label: '재고금액', hint: '재고금액이 큰 순' },
  { key: 'critical', label: '20% 미만 금액', hint: '잔여율 0~20% 재고금액이 큰 순' },
  { key: 'riskValue', label: '소진필요 금액', hint: '잔여율 75% 미만 재고금액이 큰 순' },
  { key: 'riskRatio', label: '소진필요 비중', hint: '재고 대비 잔여율 75% 미만 비중이 높은 순' },
  { key: 'remain', label: '소비기한 임박', hint: '가장 임박한 배치의 잔여일이 짧은 순' },
  { key: 'shipped', label: '주간 출고', hint: '이번 주 출고금액이 큰 순' },
  { key: 'ratio', label: '전월 출고 比', hint: '재고금액 ÷ 전월 전체 출고금액이 높은 순' },
  { key: 'delta', label: '전주 比 증가', hint: '전주 대비 재고금액이 많이 늘어난 순' },
];

const DETAIL_PAGE_SIZE = 20;

/** 잔여일 → 색. `/stock` 의 유통기한 판정과 같은 구간이다 (폐기 ≤0 / 임박 1~30 / 긴급 31~60 / 양호 61+) */
function remainDayTone(day: number | null) {
  if (day === null) return 'text-neutral-300';
  if (day <= 0) return 'text-[#B71C1C] font-bold';
  if (day <= 30) return 'text-[#D32F2F] font-semibold';
  if (day <= 60) return 'text-[#E65100]';
  return 'text-neutral-600';
}

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
  const [axis, setAxis] = useState<BoardAxis>('team');
  const [weekEnd, setWeekEnd] = useState<string | undefined>(undefined);
  const [unit, setUnit] = useState<MoneyUnit>('million');
  const [isAdmin, setIsAdmin] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  /** 펼친 칸. 메인 표의 한 줄과 1:1 로 대응한다(팀별 = CM × 카테고리, 채널별 = 채널) */
  const [drill, setDrill] = useState<Drill | null>(null);
  const [refreshingHierarchy, setRefreshingHierarchy] = useState(false);
  const [detailSort, setDetailSort] = useState<DetailSortKey>('stockValue');
  const [detailPage, setDetailPage] = useState(0);
  const [detailQuery, setDetailQuery] = useState('');

  // 스코프는 고정이다 — `/stock` 의 「통합 재고」(플랜트+물류)와 같은 정의여야 두 화면의 금액이 맞는다.
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['weekly-board', weekEnd ?? 'latest'],
    queryFn: () => getWeeklyBoard(weekEnd, [...WEEKLY_DEFAULT_SCOPES]),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  // 채널별 표는 탭을 열었을 때만 부른다. 팀별만 보는 사용자에게 조회를 늘리지 않는다.
  const {
    data: channelData,
    isLoading: channelLoading,
    refetch: refetchChannel,
    isRefetching: channelRefetching,
  } = useQuery({
    queryKey: ['weekly-channel-board', weekEnd ?? 'latest'],
    queryFn: () => getWeeklyChannelBoard(weekEnd, [...WEEKLY_DEFAULT_SCOPES]),
    enabled: axis === 'channel',
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
      // 적재는 제품계층 마스터도 함께 갱신하므로 두 축을 다 다시 받는다.
      if (result.ok) await Promise.all([refetch(), refetchChannel()]);
    } finally {
      setCapturing(false);
    }
  };

  /**
   * 제품계층 기준정보만 다시 받는다(관리자).
   * 마스터는 기준정보라 갱신하면 **이미 적재된 과거 주차까지** 같은 채널로 다시 접힌다.
   */
  const handleRefreshHierarchy = async () => {
    setRefreshingHierarchy(true);
    setCaptureMessage(null);
    try {
      const result = await refreshMaterialHierarchyAction();
      setCaptureMessage(result.message);
      if (result.ok) await refetchChannel();
    } finally {
      setRefreshingHierarchy(false);
    }
  };

  const teamBoard = data?.board ?? null;
  const channelBoard = channelData?.board ?? null;

  /**
   * 지금 보고 있는 축의 결과.
   *
   * `totals`·`movement`·`hasPrevious` 는 두 축이 **같은 타입·같은 계산**이라 그대로 공유한다.
   * 축마다 다른 것은 행 구성과 아래 안내 블록뿐이다.
   */
  const board = axis === 'channel' ? channelBoard : teamBoard;
  /** 제목·주차·비고 등 표 바깥 정보. 축에 따라 문구가 다르다 */
  const meta = axis === 'channel' ? channelData : data;
  const hasPrevious = board?.hasPrevious ?? false;
  const activeWeek = data?.weekEnd ?? null;
  const boardLoading = axis === 'channel' ? channelLoading : isLoading;
  const boardRefetching = axis === 'channel' ? channelRefetching : isRefetching;
  /** 「구분」 열 개수. 헤더 colSpan 과 합계행이 이 값을 따른다 */
  const groupColCount = axis === 'channel' ? 1 : 3;
  /**
   * 이 주차의 50% 미만이 세부 구간으로 완전히 쪼개졌는지.
   * false 면(세부 열 추가 이전 주차) 세 칸을 합쳐 50% 미만 한 칸으로 그린다 — 0 으로 채우지 않는다.
   */
  const splitAvailable = board?.movement.splitAvailable ?? false;
  /** 세부 구간이 역산 추정치인 주차(2026-10-18). 실측과 섞이지 않게 화면 곳곳에 표시를 붙인다 */
  const splitEstimated = splitAvailable && (board?.movement.splitEstimated ?? false);

  // 주차를 바꾸거나 축을 바꾸면 펼쳐 둔 상세는 좌표가 다른 것이라 닫는다.
  // 「전체보기」만은 좌표가 없어 어느 주차·축에서도 같은 모수라 열어 둔다.
  useEffect(() => {
    setDrill((current) => (current?.axis === 'all' ? current : null));
  }, [activeWeek, axis]);

  // 상세는 행을 눌렀을 때만 부른다. 첫 화면 로딩에는 영향이 없다.
  const { data: detailData, isFetching: detailLoading } = useQuery({
    queryKey: ['weekly-detail', activeWeek, drill ? drillKey(drill) : 'none'],
    queryFn: () => {
      const target = drill!;
      // 전체보기는 필터를 하나도 걸지 않는다 — 합계가 위 표의 합계행과 같아야 한다.
      if (target.axis === 'all') {
        return getWeeklyCategoryDetail(activeWeek!, null, null, [...WEEKLY_DEFAULT_SCOPES], null);
      }
      // 채널 드릴다운은 카테고리·CM 을 걸지 않는다. 필터를 겹치면 상세 합계가 위 표의 그 줄과 어긋난다.
      return target.axis === 'channel'
        ? getWeeklyCategoryDetail(activeWeek!, null, null, [...WEEKLY_DEFAULT_SCOPES], target.channel)
        : getWeeklyCategoryDetail(
            activeWeek!,
            target.category,
            target.cm,
            [...WEEKLY_DEFAULT_SCOPES],
            null
          );
    },
    enabled: !!activeWeek && !!drill,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const detail = detailData?.detail ?? null;
  const hasRemainDay = detail?.hasRemainDay ?? false;
  const hasBucketQuantities = detail?.hasBucketQuantities ?? false;

  /** 정렬·검색은 클라이언트에서 한다 — 카테고리 하나가 수백 SKU 라 왕복할 이유가 없다 */
  const detailRows = useMemo(() => {
    if (!detail) return [] as WeeklyDetailRow[];
    const keyword = detailQuery.trim().toLowerCase();
    const filtered = keyword
      ? detail.rows.filter(
          (row) =>
            row.materialCode.toLowerCase().includes(keyword) ||
            row.productName.toLowerCase().includes(keyword)
        )
      : detail.rows;

    /** 위 표의 행 순서. 표에 없는 조합은 맨 뒤로 보낸다 */
    const groupKeyOf = (row: WeeklyDetailRow) =>
      axis === 'channel' ? row.channel : `${row.cm}|${row.category}`;
    const groupRank = new Map<string, number>(
      axis === 'channel'
        ? (channelBoard?.rows ?? []).map((row, index) => [row.channel as string, index])
        : (teamBoard?.rows ?? []).map((row, index) => [`${row.cm}|${row.category}`, index])
    );
    const rankOf = (row: WeeklyDetailRow) => groupRank.get(groupKeyOf(row)) ?? Number.MAX_SAFE_INTEGER;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (detailSort) {
        case 'group':
          return rankOf(a) - rankOf(b) || b.stockValue - a.stockValue;
        case 'critical':
          return b.under50Split.under20 - a.under50Split.under20 || b.riskValue - a.riskValue;
        case 'riskValue':
          return b.riskValue - a.riskValue;
        case 'riskRatio':
          return b.riskRatio - a.riskRatio;
        case 'remain':
          // 잔여일이 없는 행(기한없음·열이 없던 주차)은 임박한 것처럼 위로 올리면 안 된다. 항상 뒤로 보낸다.
          if (a.minRemainDay === null && b.minRemainDay === null) return b.stockValue - a.stockValue;
          if (a.minRemainDay === null) return 1;
          if (b.minRemainDay === null) return -1;
          return a.minRemainDay - b.minRemainDay;
        case 'shipped':
          return b.shippedValue - a.shippedValue;
        case 'ratio':
          if (
            a.stockToPreviousMonthShipmentRatio === null &&
            b.stockToPreviousMonthShipmentRatio === null
          )
            return b.stockValue - a.stockValue;
          if (a.stockToPreviousMonthShipmentRatio === null) return 1;
          if (b.stockToPreviousMonthShipmentRatio === null) return -1;
          return b.stockToPreviousMonthShipmentRatio - a.stockToPreviousMonthShipmentRatio;
        case 'delta':
          return (b.stockDelta ?? 0) - (a.stockDelta ?? 0);
        default:
          return b.stockValue - a.stockValue;
      }
    });
    return sorted;
  }, [detail, detailSort, detailQuery, axis, channelBoard, teamBoard]);

  const detailPageCount = Math.max(1, Math.ceil(detailRows.length / DETAIL_PAGE_SIZE));
  const detailPageSafe = Math.min(detailPage, detailPageCount - 1);
  const detailPageRows = detailRows.slice(
    detailPageSafe * DETAIL_PAGE_SIZE,
    detailPageSafe * DETAIL_PAGE_SIZE + DETAIL_PAGE_SIZE
  );

  /**
   * 상세 리스트를 엑셀로 내린다 — **화면에 보이는 페이지가 아니라 필터·정렬이 끝난 전체 목록**이다.
   *
   * DISPO 는 화면 표에는 없지만 파일에는 넣는다. 카테고리·CM 이 DISPO 에서 판정되므로,
   * 받아서 다시 피벗할 때 「이 줄이 왜 이 칸에 들어갔나」를 가르는 구분자가 그 값 하나뿐이다.
   */
  const handleDownloadDetail = () => {
    if (!detail || detailRows.length === 0) return;
    const label = (drill ? drillLabel(drill).replace(/ · /g, '_') : '전체').replace(/\//g, '-');
    const isAll = drill?.axis === 'all';

    exportToExcel(
      detailRows.map((row) => ({
        // 전체보기 파일은 칸이 섞여 있으므로 구분 열(CM·공장·카테고리·채널)을 맨 앞에 둔다.
        // 아래 본문에 같은 키가 다시 나오지만 객체 키 순서는 처음 넣은 자리를 유지하므로 값만 덮인다.
        ...(isAll ? { CM: row.cm, 공장: row.plant, 카테고리: row.category, 채널: row.channel } : {}),
        '자재코드': row.materialCode,
        '품명': row.productName,
        // 화면에는 없는 열이다. 카테고리·CM 판정의 근거라 파일에서는 첫 구분자로 둔다.
        'DISPO': row.dispo || (isOverriddenMaterial(row.materialCode) ? '(임시매핑)' : '(마스터정비)'),
        // 무엇을 보고 카테고리를 정했는지. 받아서 피벗할 때 근거별로 걸러낼 수 있게 둔다.
        // 순서는 판정 순서(`categoryOfMaterial`)와 같아야 한다 — 상품대역이 DISPO 보다 앞선다.
        '분류근거': isMerchandiseMaterial(row.materialCode)
          ? '상품대역(6xxxxxxx)'
          : row.dispo
            ? 'DISPO'
            : isOverriddenMaterial(row.materialCode)
              ? '임시매핑'
              : '미분류',
        'CM': row.cm,
        '공장': row.plant,
        '카테고리': row.category,
        // 채널 축은 제품계층 LV2 하나로 판정한다. 근거 열(LV2)을 함께 내려 받아서 다시 피벗할 수 있게 둔다.
        '제품계층 LV2': row.lv2 || '(마스터없음)',
        '채널': row.channel,
        '창고그룹': row.scopes.map((scope) => WEEKLY_STORAGE_SCOPE_LABELS[scope]).join(', '),
        '단위': row.unit,
        '재고수량': Math.round(row.stockQty),
        '재고금액': Math.round(row.stockValue),
        '전주 재고금액': detail.hasPrevious ? Math.round(row.previousStockValue) : null,
        '전주 比': row.stockDelta === null ? null : Math.round(row.stockDelta),
        '잔여일(최악 배치)': row.minRemainDay === null ? null : Math.round(row.minRemainDay),
        '잔여율(금액가중, %)': row.avgRemainRate === null ? null : Math.round(row.avgRemainRate),
        '소진필요(75%미만)': Math.round(row.riskValue),
        '소진필요 비중(%)': Math.round(row.riskRatio * 100),
        ...WEEKLY_BUCKET_KEYS.reduce<Record<string, number | string | null>>((acc, key) => {
          const name = WEEKLY_BUCKET_LABELS[key].split(' [')[0];
          // 구간 수량은 열이 없던 주차에서 0 으로 채워져 있다. 0 과 「모름」을 섞지 않는다.
          acc[`${name} 수량`] = row.hasBucketQuantities ? Math.round(row.bucketQuantities[key]) : null;
          acc[`${name} 금액`] = Math.round(row.buckets[key]);
          // 50% 미만 바로 뒤에 세부 구간을 붙인다. 세부 열이 없던 주차는 0 이 아니라 빈칸이다.
          if (key === 'under50') {
            // 세부 구간 값이 실측인지 추정인지. 받아서 쓸 때 추정치를 걸러낼 수 있게 근거를 함께 내린다.
            acc['50%미만 세부구간 근거'] = !row.hasUnder50Split
              ? '미분해'
              : row.under50SplitEstimated
                ? '역산추정(MB51)'
                : '실측';
            WEEKLY_UNDER50_KEYS.forEach((splitKey) => {
              const splitName = `50%미만 ${WEEKLY_UNDER50_LABELS[splitKey]}`;
              acc[`${splitName} 수량`] =
                row.hasUnder50Split && row.hasBucketQuantities
                  ? Math.round(row.under50SplitQuantities[splitKey])
                  : null;
              acc[`${splitName} 금액`] = row.hasUnder50Split
                ? Math.round(row.under50Split[splitKey])
                : null;
            });
          }
          return acc;
        }, {}),
        '주간 출고금액': Math.round(row.shippedValue),
        '주간 출고수량': Math.round(row.shippedQty),
        '주간 생산금액': Math.round(row.producedValue),
        '주간 생산수량': Math.round(row.producedQty),
        '전월 출고금액': Math.round(row.previousMonthShipmentValue),
        '전월 출고 比(%)':
          row.stockToPreviousMonthShipmentRatio === null
            ? null
            : Math.round(row.stockToPreviousMonthShipmentRatio * 100),
        '단가': Math.round(row.unitPrice),
        '단가 기준월': row.priceMonth || '',
      })),
      `주간재고_${label}_${activeWeek || ''}`
    );
  };

  /** 같은 칸을 다시 누르면 접는다. 축이 달라지면 좌표도 달라지므로 키로 비교한다 */
  const toggleDrill = (next: Drill) => {
    setDetailPage(0);
    setDetailQuery('');
    // 「구분순」은 전체보기 전용이다. 전체보기로 들어가면 기본으로 켜고, 한 칸으로 좁히면 재고금액순으로 돌린다.
    if (next.axis === 'all') setDetailSort('group');
    else if (detailSort === 'group') setDetailSort('stockValue');
    setDrill((current) => (current && drillKey(current) === drillKey(next) ? null : next));
  };

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

  /** 상세 연령구간은 수량을 주지표, 금액을 보조지표로 같은 셀에 쌓는다. */
  const bucketQuantityCell = (
    quantity: number,
    value: number,
    itemUnit: string,
    available: boolean
  ) => {
    if (!available) {
      return (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="text-neutral-300">-</span>
          <span className="mt-0.5 text-[9px] tabular-nums text-neutral-400">{money(value)}</span>
        </span>
      );
    }
    if (Math.abs(quantity) < 0.0005 && Math.round(value) === 0) {
      return <span className="text-neutral-300">-</span>;
    }
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className="font-medium tabular-nums text-neutral-700">
          {Math.round(quantity).toLocaleString('ko-KR')}
          <span className="ml-0.5 text-[8px] font-normal text-neutral-400">{itemUnit}</span>
        </span>
        <span className="mt-0.5 text-[9px] tabular-nums text-neutral-400">{money(value)}</span>
      </span>
    );
  };

  /**
   * 메인 표의 50% 미만 자리. 세부 구간이 있으면 3칸, 없으면 3칸을 합친 1칸(미분해)으로 그린다.
   * 미분해 주차를 0 세 칸으로 채우지 않는 이유 — 「0~20% 재고 없음」으로 읽히기 때문이다.
   */
  const renderUnder50Cells = (
    under50: number,
    split: WeeklyUnder50Split,
    padding: string,
    isTotal: boolean
  ) => {
    const border = isTotal ? 'border-l border-neutral-200' : 'border-l border-neutral-100';
    if (!splitAvailable || !isUnder50SplitComplete(split)) {
      return (
        <td
          colSpan={3}
          title="세부 구간 적재 이전 주차라 50% 미만 합계만 있습니다"
          className={`${border} px-1.5 ${padding} text-center tabular-nums ${
            isTotal ? 'text-[#C62828]' : BUCKET_CELL_TONE.under50
          }`}
        >
          {isTotal ? money(under50) : moneyCell(under50)}
          <span className="ml-1 text-[9px] font-normal text-neutral-400">미분해</span>
        </td>
      );
    }
    return WEEKLY_UNDER50_KEYS.map((key, index) => (
      <td
        key={key}
        className={`px-1.5 ${padding} tabular-nums ${
          isTotal ? 'font-bold' : UNDER50_CELL_TONE[key]
        } ${index === 0 ? border : ''}`}
        style={isTotal ? { color: UNDER50_COLORS[key] } : undefined}
      >
        {isTotal ? money(split[key]) : moneyCell(split[key])}
      </td>
    ));
  };

  /** 소진이 필요한 구간(잔여율 75% 미만)의 금액과 비중 */
  const riskOf = (buckets: WeeklyBuckets, stockValue: number) => {
    const value = RISK_BUCKET_KEYS.reduce((sum, key) => sum + (buckets[key] || 0), 0);
    return { value, ratio: stockValue > 0 ? value / stockValue : 0 };
  };

  /**
   * 차트·「상세 보기」 칩이 쓰는 구간 묶음. 팀별은 카테고리, 채널별은 채널이 한 조각이다.
   * 두 축이 같은 컴포넌트를 쓰도록 여기서 한 번만 이름을 맞춘다.
   */
  const segments = useMemo(() => {
    if (axis === 'channel') {
      return (channelBoard?.channelBuckets ?? []).map((entry) => ({
        key: entry.channel as string,
        label: entry.channel as string,
        buckets: entry.buckets,
        under50Split: entry.under50Split,
        total: entry.total,
        drill: { axis: 'channel', channel: entry.channel } as Drill,
      }));
    }
    return (teamBoard?.categoryBuckets ?? []).map((entry) => ({
      key: entry.category as string,
      label: entry.category as string,
      buckets: entry.buckets,
      under50Split: entry.under50Split,
      total: entry.total,
      drill: { axis: 'team', cm: null, category: entry.category } as Drill,
    }));
  }, [axis, channelBoard, teamBoard]);

  /** 메인 표의 행. 축마다 「구분」 칸만 다르고 나머지 열은 완전히 같다 */
  const displayRows = useMemo<DisplayRow[]>(() => {
    if (axis === 'channel') {
      return (channelBoard?.rows ?? []).map((row) => {
        const target: Drill = { axis: 'channel', channel: row.channel };
        return {
          ...row,
          key: row.channel,
          groupCells: [
            {
              text: row.channel,
              // 미분류는 매핑이 빠진 자리라 성격이 다르다. 칩으로 눈에 띄게 둔다.
              tone: row.channel === '미분류' ? ('badge' as const) : ('plain' as const),
              caret: true,
            },
          ],
          showDivider: row.channel === '미분류',
          isOpen: !!drill && drillKey(drill) === drillKey(target),
          title: `${row.channel} 상세 보기`,
          drill: target,
        };
      });
    }

    const rows = teamBoard?.rows ?? [];
    return rows.map((row, index) => {
      const target: Drill = { axis: 'team', cm: row.cm, category: row.category };
      // 생산 CM 행과 상품·미분류 행 사이에 선을 하나 넣어 성격이 다른 행임을 드러낸다.
      const isAside = row.cm === '상품' || row.cm === '미분류';
      const previousIsAside =
        index > 0 && (rows[index - 1].cm === '상품' || rows[index - 1].cm === '미분류');
      return {
        ...row,
        key: `${row.cm}-${row.plant}-${row.category}`,
        groupCells: [
          { text: row.cm, tone: isAside ? ('badge' as const) : ('plain' as const) },
          { text: row.plant, tone: 'muted' as const },
          { text: row.category, tone: 'plain' as const, caret: true },
        ],
        showDivider: isAside && !previousIsAside,
        isOpen: !!drill && drillKey(drill) === drillKey(target),
        title: `${row.cm} ${row.category} 상세 보기`,
        drill: target,
      };
    });
  }, [axis, channelBoard, teamBoard, drill]);

  /**
   * 누적막대 계열. 세부 구간이 있는 주차는 50% 미만 조각을 세 조각(진한 빨강 → 옅은 빨강)으로 쪼갠다.
   * 쪼갠 조각의 합이 50% 미만과 같으므로 막대 높이·「위험」 문구는 쪼개기 전과 똑같다.
   */
  const chartSeries = useMemo(
    () =>
      WEEKLY_BUCKET_KEYS.flatMap((key) => {
        if (key === 'under50' && splitAvailable) {
          return WEEKLY_UNDER50_KEYS.map((splitKey) => ({
            label: `${WEEKLY_UNDER50_LABELS[splitKey]} [내부소진]`,
            color: UNDER50_COLORS[splitKey],
            emphasis: true,
            values: segments.map((entry) => toEok(entry.under50Split[splitKey])),
          }));
        }
        return [
          {
            label: WEEKLY_BUCKET_LABELS[key],
            color: BUCKET_COLORS[key],
            emphasis: RISK_BUCKET_KEYS.includes(key),
            values: segments.map((entry) => toEok(entry.buckets[key])),
          },
        ];
      }),
    [segments, splitAvailable]
  );

  /** 세부 구간 막대의 공통 축 — 줄끼리 길이를 비교할 수 있게 50% 미만이 가장 큰 줄을 100% 로 둔다 */
  const under50AxisMax = useMemo(
    () => Math.max(1, ...segments.map((entry) => entry.buckets.under50)),
    [segments]
  );

  /**
   * 소진필요(잔여율 75% 미만) 재고 순위. 누적막대와 같은 `segments` 를 접은 것이라 숫자가 갈릴 수 없다.
   * 막대 길이는 위험 **금액**, 옆 %는 그 줄 재고 중 위험 **비중**이다 — 비중만 보면 작은 줄이 과대평가된다.
   */
  const riskRankItems = useMemo<RankBarItem[]>(
    () =>
      segments
        .map((entry) => {
          const risk = riskOf(entry.buckets, entry.total);
          return {
            key: entry.key,
            label: entry.label,
            sub: `재고 ${formatNoteAmount(entry.total)}`,
            value: risk.value,
            share: risk.ratio * 100,
          };
        })
        .filter((item) => Math.round(item.value) > 0)
        .sort((a, b) => b.value - a.value),
    [segments]
  );

  const detailSectionRef = useRef<HTMLElement>(null);

  /** 순위 막대 클릭 → 위쪽 상세 보기를 그 줄로 열고 그 자리로 스크롤한다(맨 아래에서 누르므로 안 보이면 반응이 없는 것처럼 보인다) */
  const handleRiskSelect = (key: string) => {
    const target = segments.find((entry) => entry.key === key);
    if (!target) return;
    const opening = !drill || drillKey(drill) !== drillKey(target.drill);
    toggleDrill(target.drill);
    if (opening) detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const selectedRiskKey =
    drill ? segments.find((entry) => drillKey(entry.drill) === drillKey(drill))?.key ?? null : null;

  /** 진행 중인 주차(주말이 아직 안 지남)면 흐름 열이 주중 누계라 잠정치다 */
  const isProvisionalWeek = !!activeWeek && activeWeek >= seoulToday();

  /**
   * 상세표의 구간 열. 메인 표와 같은 규칙으로 50% 미만 자리를 세부 3칸(또는 1칸)으로 펼친다.
   * 열 정의를 한 곳에 두어 머리·본문·합계행이 같은 순서로 그려지게 한다.
   */
  const detailSplitOn = detail?.hasUnder50Split ?? false;
  const detailBucketColumns = WEEKLY_BUCKET_KEYS.flatMap((key) => {
    if (key === 'under50' && detailSplitOn) {
      return WEEKLY_UNDER50_KEYS.map((splitKey) => ({
        key: `under50-${splitKey}`,
        label: WEEKLY_UNDER50_LABELS[splitKey],
        tone: UNDER50_CELL_TONE[splitKey],
        headColor: UNDER50_COLORS[splitKey] as string | undefined,
        quantityOf: (row: WeeklyDetailRow) => row.under50SplitQuantities[splitKey],
        valueOf: (row: WeeklyDetailRow) => row.under50Split[splitKey],
        availableOf: (row: WeeklyDetailRow) => row.hasBucketQuantities && row.hasUnder50Split,
        total: detail?.totals.under50Split[splitKey] ?? 0,
      }));
    }
    return [
      {
        key,
        label: WEEKLY_BUCKET_LABELS[key].split(' [')[0],
        tone: BUCKET_CELL_TONE[key],
        headColor: RISK_BUCKET_KEYS.includes(key) ? '#C62828' : undefined,
        quantityOf: (row: WeeklyDetailRow) => row.bucketQuantities[key],
        valueOf: (row: WeeklyDetailRow) => row.buckets[key],
        availableOf: (row: WeeklyDetailRow) => row.hasBucketQuantities,
        total: detail?.totals.buckets[key] ?? 0,
      },
    ];
  });
  /** 상세표 전체 열 수 — 앞 9칸 + 구간 열 + 뒤 3칸. 빈 행의 colSpan 이 이 값을 따른다 */
  const detailColumnCount = 9 + detailBucketColumns.length + 3;

  /**
   * 「잔여율 20% 미만」 목록에서 상세로 넘어간다. 전체보기 + 20% 미만 금액순으로 열고,
   * SKU 를 눌렀으면 그 코드로 검색까지 걸어 바로 그 줄이 보이게 한다.
   */
  const openCriticalDetail = (materialCode?: string) => {
    setDetailPage(0);
    setDetailQuery(materialCode ?? '');
    setDetailSort('critical');
    setDrill(ALL_DRILL);
    detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** 소비기한 구간별 주간 재고변동 표의 열 — 세부 구간이 있으면 3칸 + 50% 미만 계 */
  const movementColumns: {
    key: string;
    label: string;
    color?: string;
    split?: WeeklyUnder50Key;
    bucket?: keyof WeeklyBuckets;
    subtotal?: boolean;
  }[] = [
    ...(splitAvailable
      ? WEEKLY_UNDER50_KEYS.map((splitKey) => ({
          key: `split-${splitKey}`,
          label: WEEKLY_UNDER50_LABELS[splitKey],
          color: UNDER50_COLORS[splitKey],
          split: splitKey,
        }))
      : []),
    {
      key: 'under50',
      label: splitAvailable ? '50% 미만 계' : '50% 미만',
      bucket: 'under50' as const,
      subtotal: splitAvailable,
    },
    ...OTHER_BUCKET_KEYS.map((key) => ({
      key,
      label: WEEKLY_BUCKET_LABELS[key].split(' [')[0],
      bucket: key,
    })),
  ];

  return (
    <div className="p-3 lg:p-5 space-y-3">
      {/*
        축 전환 탭.

        ⚠️ 두 탭은 **같은 주차·같은 스냅샷·같은 스코프**를 보고 묶는 축만 다르다.
        그래서 탭을 바꿔도 합계(재고·출고·생산·구간액)는 원 단위까지 같아야 한다.
        한쪽에만 필터를 더하고 싶어지면 그 순간 두 숫자가 갈린다 — 축은 여기서만 갈라진다.
      */}
      <div className="flex items-center gap-1 border-b border-neutral-200">
        {AXIS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setAxis(tab.key)}
            title={tab.hint}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
              axis === tab.key
                ? 'border-[#1565C0] text-[#1565C0]'
                : 'border-transparent text-neutral-400 hover:text-neutral-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <InfoTooltip text={AXIS_TABS.find((tab) => tab.key === axis)?.hint || ''} />
      </div>

      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-neutral-900">
            {axis === 'channel' ? '' : '1. '}
            {meta?.labels.title || (axis === 'channel' ? '채널별 재고현황' : '완제품 재고현황')}
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
          {meta?.capturedAt && (
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              적재 {capturedLabel(meta.capturedAt)}
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
            <RefreshCw size={13} className={boardRefetching ? 'animate-spin' : ''} />
          </button>

          {isAdmin && axis === 'channel' && (
            <button
              onClick={handleRefreshHierarchy}
              disabled={refreshingHierarchy}
              title="자재 → 제품계층 마스터를 BigQuery 에서 다시 받습니다. 기준정보라 과거 주차도 함께 다시 분류됩니다."
              className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              <Layers size={13} className={refreshingHierarchy ? 'animate-pulse' : ''} />
              {refreshingHierarchy ? '갱신 중' : '제품계층 갱신'}
            </button>
          )}

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

      {boardLoading && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          불러오는 중…
        </div>
      )}

      {!boardLoading && meta && !meta.board && (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm font-medium text-neutral-700">
            {meta.message || '아직 적재된 주차가 없습니다.'}
          </p>
          {isAdmin && (
            <p className="mt-2 text-xs text-[#1565C0]">
              위 <b>적재</b> 버튼으로 이번 주를 채울 수 있습니다.
            </p>
          )}
        </div>
      )}

      {/*
        제품계층 마스터가 비어 있으면 채널 표는 전부 「미분류」가 된다.
        그럴듯한 빈 표를 보여주는 대신 무엇을 해야 하는지 그 자리에서 알려준다.
      */}
      {axis === 'channel' && channelData?.hierarchyEmpty && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <b>제품계층 기준정보가 아직 없습니다.</b> 채널 분류의 원천인 자재 → 제품계층 마스터
          (snop_material_hierarchy)가 비어 있어 모든 재고가 미분류로 잡힙니다.
          {isAdmin
            ? ' 위 「제품계층 갱신」 버튼을 한 번 누르면 채워지고, 이미 적재된 과거 주차도 함께 분류됩니다.'
            : ' 관리자에게 갱신을 요청해 주세요.'}
        </div>
      )}

      {board && (
        <>
          {/* 1. 메인 표 */}
          <section className="rounded-lg border border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_230px]">
              <div className="overflow-x-auto">
                <table
                  className={`w-full text-right text-xs ${
                    axis === 'channel' ? 'min-w-[1120px]' : 'min-w-[1240px]'
                  }`}
                >
                  <thead>
                    {/* 열이 많아 그룹 머리행으로 흐름·연령·재고 지표 경계를 고정한다. */}
                    <tr className="bg-neutral-100 text-[10px] text-neutral-500">
                      <th
                        className="px-1.5 pt-1.5 text-center font-bold"
                        colSpan={groupColCount}
                        rowSpan={3}
                      >
                        <span className="text-[11px] text-neutral-700">
                          {axis === 'channel' ? '채널' : '구분'}
                        </span>
                      </th>
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 pt-1.5 text-center font-medium"
                        colSpan={3}
                      >
                        주간 흐름 <span className="text-neutral-400">{meta?.labels.flow}</span>
                      </th>
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 pt-1.5 text-center font-medium"
                        colSpan={7}
                      >
                        소비기한 잔여율 구간별 재고금액
                      </th>
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 pt-1.5 text-center font-medium"
                        colSpan={4}
                      >
                        당주 재고
                      </th>
                    </tr>
                    <tr className="bg-neutral-100 text-[11px] text-neutral-700">
                      <th className="border-l border-neutral-200 px-1.5 pb-1.5 font-bold" rowSpan={2}>
                        {meta?.labels.previousStock}
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold" rowSpan={2}>출고</th>
                      <th className="px-1.5 pb-1.5 font-bold" rowSpan={2}>생산</th>
                      {/* 50% 미만은 세부 3칸 위에 묶음 머리를 얹는다. 세 칸의 합이 이 구간이다 */}
                      <th
                        className="border-l border-neutral-200 px-1.5 pb-0.5 text-center font-bold text-[#C62828]"
                        colSpan={3}
                      >
                        <span className="inline-flex items-center gap-1">
                          50% 미만
                          <span className="font-normal text-neutral-400">[내부소진]</span>
                          <InfoTooltip text={UNDER50_HINT} />
                          {splitEstimated && <EstimateBadge />}
                        </span>
                      </th>
                      {OTHER_BUCKET_KEYS.map((key) => (
                        <th
                          key={key}
                          rowSpan={2}
                          className={`px-1.5 pb-1.5 font-bold ${
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
                      <th className="border-l border-neutral-200 px-1.5 pb-1.5 font-bold" rowSpan={2}>
                        {meta?.labels.currentStock}
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold" rowSpan={2}>
                        <span className="flex items-center justify-end gap-1">
                          소진 필요
                          <InfoTooltip text="소비기한 잔여율 75% 미만(50% 미만[0~20·20~40·40~50%] + 50~70% + 70~75%) 재고금액과 그 비중입니다. 이 비중이 높은 행부터 소진 계획이 필요합니다." />
                        </span>
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold" rowSpan={2}>
                        <span className="flex items-center justify-end gap-1">
                          전월 출고 比
                          <InfoTooltip text="현재 재고금액 ÷ 직전 달 1일~말일 출고금액입니다. 출고금액도 재고와 똑같이 완제품 재고단가로 환산하므로, 200%는 '전월 한 달 출고량의 2배를 쌓아두고 있다'로 읽습니다. 완료된 한 달을 분모로 써 월초에도 비율이 흔들리지 않습니다." />
                        </span>
                        재고금액
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold" rowSpan={2}>
                        <span className="flex items-center justify-end gap-1">
                          전월 매출 比
                          <InfoTooltip text="현재 재고금액 ÷ 직전 달 1일~말일 실제 납품매출액(NETWR)입니다. 완료된 전월 매출과 현재 재고자산을 비교해 현금 흐름 부담을 판단합니다." />
                        </span>
                        재고금액
                      </th>
                    </tr>
                    <tr className="bg-neutral-100 text-[11px]">
                      {WEEKLY_UNDER50_KEYS.map((key, index) => (
                        <th
                          key={key}
                          className={`px-1.5 pb-1.5 font-bold ${index === 0 ? 'border-l border-neutral-200' : ''}`}
                          style={{ color: UNDER50_COLORS[key] }}
                        >
                          {WEEKLY_UNDER50_LABELS[key]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const risk = riskOf(row.buckets, row.stockValue);
                      const isOpen = row.isOpen;
                      return (
                        <tr
                          key={row.key}
                          // 행 전체가 드릴다운 버튼이다 — 「어느 칸의 상세인가」가 표에서 바로 보여야 한다.
                          onClick={() => toggleDrill(row.drill)}
                          title={row.title}
                          className={`cursor-pointer border-b border-neutral-100 hover:bg-[#E3F2FD]/40 ${
                            isOpen ? 'bg-[#E3F2FD]/70' : ''
                          } ${row.showDivider ? 'border-t-2 border-t-neutral-200' : ''}`}
                        >
                          {row.groupCells.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className={`px-1.5 py-1.5 text-center ${
                                cell.tone === 'muted' ? 'text-neutral-500' : 'font-medium'
                              }`}
                            >
                              <span className="inline-flex items-center gap-0.5">
                                {cell.caret &&
                                  (isOpen ? (
                                    <ChevronDown size={11} className="text-[#1565C0]" />
                                  ) : (
                                    <ChevronRight size={11} className="text-neutral-300" />
                                  ))}
                                {cell.tone === 'badge' ? (
                                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                                    {cell.text}
                                  </span>
                                ) : (
                                  cell.text
                                )}
                              </span>
                            </td>
                          ))}
                          <td className="border-l border-neutral-100 px-1.5 py-1.5 tabular-nums text-neutral-500">
                            {hasPrevious ? moneyCell(row.previousStockValue) : '-'}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                            {moneyCell(row.shippedValue)}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                            {moneyCell(row.producedValue)}
                          </td>
                          {renderUnder50Cells(row.buckets.under50, row.under50Split, 'py-1.5', false)}
                          {OTHER_BUCKET_KEYS.map((key) => (
                            <td
                              key={key}
                              className={`px-1.5 py-1.5 tabular-nums ${BUCKET_CELL_TONE[key]}`}
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
                            {percent(row.stockToPreviousMonthShipmentRatio)}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-600">
                            {percent(row.stockToPreviousMonthSalesRatio)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-[#FFF3E0] font-bold">
                      <td className="px-1.5 py-2 text-center" colSpan={groupColCount}>
                        합계
                      </td>
                      <td className="border-l border-neutral-200 px-1.5 py-2 tabular-nums">
                        {moneyOrDash(board.totals.previousStockValue, hasPrevious)}
                      </td>
                      <td className="px-1.5 py-2 tabular-nums">{money(board.totals.shippedValue)}</td>
                      <td className="px-1.5 py-2 tabular-nums">{money(board.totals.producedValue)}</td>
                      {renderUnder50Cells(
                        board.totals.buckets.under50,
                        board.totals.under50Split,
                        'py-2',
                        true
                      )}
                      {OTHER_BUCKET_KEYS.map((key) => (
                        <td
                          key={key}
                          className={`px-1.5 py-2 tabular-nums ${
                            RISK_BUCKET_KEYS.includes(key) ? 'text-[#C62828]' : 'text-neutral-600'
                          }`}
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
                        {percent(board.totals.stockToPreviousMonthShipmentRatio)}
                      </td>
                      <td className="px-1.5 py-2 tabular-nums">
                        {percent(board.totals.stockToPreviousMonthSalesRatio)}
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
                  {splitEstimated && (
                    <span className="flex items-center gap-1 text-amber-700">
                      50% 미만 세부 구간은 역산 추정치
                      <InfoTooltip text={UNDER50_ESTIMATE_HINT} />
                    </span>
                  )}
                  {!splitAvailable && board.totals.buckets.under50 > 0 && (
                    <span className="flex items-center gap-1 text-amber-700">
                      50% 미만 세부 구간 미분해
                      <InfoTooltip text="이 주차는 0~20% · 20~40% · 40~50% 세부 구간을 적재하기 전에 찍혀 50% 미만 한 칸으로 보입니다. 재고는 소급 계산이 불가능해 다시 채울 수 없고, 다음 적재부터 세 칸으로 나뉩니다." />
                    </span>
                  )}
                  {/*
                    출고는 있는데 생산이 0 이면 대차가 성립하지 않는다. 대부분 「주 초에 적재해서
                    아직 생산 전표가 안 올라온」 경우다 — BigQuery 미러는 하루 늦게 채워지므로
                    진행 중인 주차를 그 주 월요일에 적재하면 생산이 항상 0 으로 찍힌다.
                    숫자를 감추지 말고 왜 0 인지 그 자리에서 알려준다.
                  */}
                  {board.totals.producedValue === 0 && board.totals.shippedValue > 0 && (
                    <span className="flex items-center gap-1 text-amber-700">
                      생산 0
                      <InfoTooltip text="이 주차에 생산 전표(MB51 101)가 하나도 안 잡혔습니다. 단가 문제가 아니라 적재 시점 문제입니다 — BigQuery 미러는 하루 늦게 채워지므로, 진행 중인 주차를 그 주 초에 적재하면 생산이 0 으로 찍힙니다. 주가 지난 뒤 다시 적재하면(관리자 「적재」 버튼) 채워집니다." />
                    </span>
                  )}
                </div>
              </div>

              <aside className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="mb-1 text-[10px] font-bold text-neutral-500">비고</div>
                <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-neutral-700">
                  {meta?.notes.stock}
                </pre>
              </aside>
            </div>
          </section>

          {/* 1-1. 카테고리 드릴다운 — 위 표의 한 칸을 SKU 단위로 펼친다 */}
          <section ref={detailSectionRef} className="scroll-mt-3 rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-3 py-2">
              <span className="text-[11px] font-bold text-neutral-500">상세 보기</span>
              {/* 전체보기 — 칸을 고르지 않고 스코프 전체 SKU 를 한 목록으로 펼친다. 엑셀로 받으면 전 품목이 한 시트에 담긴다 */}
              <button
                onClick={() => toggleDrill(ALL_DRILL)}
                title="모든 CM·카테고리의 SKU 를 한 목록으로 펼칩니다. 오른쪽 「엑셀」로 전 품목을 내려받을 수 있습니다."
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-bold transition-colors ${
                  drill?.axis === 'all'
                    ? 'border-[#1565C0] bg-[#1565C0] text-white'
                    : 'border-[#1565C0]/40 bg-[#E3F2FD] text-[#1565C0] hover:bg-[#BBDEFB]'
                }`}
              >
                <Layers size={11} />
                전체보기
                <span
                  className={`tabular-nums font-medium ${
                    drill?.axis === 'all' ? 'text-white/70' : 'text-[#1565C0]/60'
                  }`}
                >
                  {toEok(board.totals.stockValue).toFixed(1)}억
                </span>
              </button>
              <span className="mx-0.5 h-4 w-px bg-neutral-200" />
              {segments.map((entry) => {
                const isOpen = !!drill && drillKey(drill) === drillKey(entry.drill);
                return (
                  <button
                    key={entry.key}
                    onClick={() => toggleDrill(entry.drill)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                      isOpen
                        ? 'border-[#1565C0] bg-[#1565C0] text-white'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    {entry.label}
                    <span
                      className={`ml-1 tabular-nums ${isOpen ? 'text-white/70' : 'text-neutral-400'}`}
                    >
                      {toEok(entry.total).toFixed(1)}억
                    </span>
                  </button>
                );
              })}
              <InfoTooltip
                text={
                  axis === 'channel'
                    ? '채널 전체를 펼칩니다. 위 표의 행을 눌러도 같은 칸이 펼쳐집니다.'
                    : '카테고리 전체를 펼칩니다. 위 표의 행을 직접 누르면 그 CM × 카테고리 칸만 펼쳐집니다.'
                }
              />
              {drill && (
                <button
                  onClick={() => setDrill(null)}
                  className="ml-auto flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-50"
                >
                  <X size={11} /> 닫기
                </button>
              )}
            </div>

            {!drill && (
              <p className="px-3 py-4 text-center text-[11px] text-neutral-400">
                {axis === 'channel' ? '채널' : '카테고리'}를 누르거나 위 표의 행을 누르면 SKU 별
                재고수량·금액·소비기한이 펼쳐집니다. 「전체보기」는 전 품목을 한 목록으로 펼칩니다.
              </p>
            )}

            {drill && (
              <div className="p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-xs font-bold text-neutral-800">
                    {drillLabel(drill)}
                    <span className="ml-1.5 font-normal text-neutral-400">
                      {detail ? `${detail.totals.itemCount.toLocaleString('ko-KR')}품목` : ''}
                    </span>
                    {detail?.under50SplitEstimated && (
                      <span className="ml-1.5 align-middle">
                        <EstimateBadge label="50% 미만 세부 구간 역산 추정" />
                      </span>
                    )}
                  </h2>

                  {/* 정렬 — 금액 기준과 소비기한 임박 기준을 나란히 둔다 */}
                  <div className="flex flex-wrap items-center gap-1">
                    {DETAIL_SORTS.filter((sort) => sort.key !== 'group' || drill.axis === 'all').map((sort) => {
                      // 잔여일 열이 없는 주차에서 「소비기한 임박」을 누르면 정렬이 무의미해진다. 아예 막는다.
                      const disabled =
                        (sort.key === 'remain' && !hasRemainDay) ||
                        (sort.key === 'critical' && !detailSplitOn) ||
                        (sort.key === 'delta' && !(detail?.hasPrevious ?? false));
                      return (
                        <button
                          key={sort.key}
                          onClick={() => {
                            setDetailSort(sort.key);
                            setDetailPage(0);
                          }}
                          disabled={disabled}
                          title={
                            disabled
                              ? sort.key === 'remain'
                                ? '이 주차는 소비기한 잔여일이 적재되지 않았습니다(열 추가 이전 주차).'
                                : sort.key === 'critical'
                                  ? '이 주차는 50% 미만 세부 구간이 적재되지 않았습니다(열 추가 이전 주차).'
                                  : '전주 스냅샷이 없어 증감을 정렬할 수 없습니다.'
                              : sort.hint
                          }
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            detailSort === sort.key
                              ? 'border-[#1565C0] bg-[#E3F2FD] text-[#1565C0]'
                              : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                          }`}
                        >
                          {sort.label}
                        </button>
                      );
                    })}
                  </div>

                  <input
                    value={detailQuery}
                    onChange={(event) => {
                      setDetailQuery(event.target.value);
                      setDetailPage(0);
                    }}
                    placeholder="자재코드·품명 검색"
                    className="ml-auto w-40 rounded-md border border-neutral-200 px-2 py-1 text-[11px] outline-none focus:border-[#1565C0]"
                  />

                  {/* 화면은 20줄씩 끊어 보여주지만 파일은 필터·정렬이 끝난 전체 목록이다 */}
                  <button
                    onClick={handleDownloadDetail}
                    disabled={detailRows.length === 0}
                    title={`${detailRows.length.toLocaleString('ko-KR')}품목을 엑셀로 내려받습니다 (DISPO 포함, 지금 보이는 페이지가 아니라 전체)`}
                    className="flex items-center gap-1 rounded-md border border-green-200 bg-white px-2 py-1 text-[11px] font-bold text-green-700 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download size={12} />
                    엑셀
                  </button>
                </div>

                {detailLoading && !detail && (
                  <p className="py-8 text-center text-xs text-neutral-400">불러오는 중…</p>
                )}

                {detail && (
                  <>
                    <div className="overflow-x-auto">
                      <table
                        className={`w-full text-right text-xs ${
                          detailSplitOn ? 'min-w-[1640px]' : 'min-w-[1480px]'
                        }`}
                      >
                        <thead>
                          <tr className="bg-neutral-100 text-[10px] text-neutral-600">
                            <th className="px-1.5 py-1.5 text-left font-bold">자재코드</th>
                            <th className="px-1.5 py-1.5 text-left font-bold">품명</th>
                            <th className="border-l border-neutral-200 px-1.5 py-1.5 font-bold">
                              재고수량
                            </th>
                            <th className="px-1.5 py-1.5 font-bold">재고금액</th>
                            <th className="px-1.5 py-1.5 font-bold">전주 比</th>
                            <th className="border-l border-neutral-200 px-1.5 py-1.5 font-bold">
                              <span className="flex items-center justify-end gap-1">
                                잔여일
                                <InfoTooltip text="그 SKU 에서 가장 임박한 배치의 소비기한 잔여일입니다. 평균이 아니라 최솟값이라, 소량이라도 곧 폐기될 배치가 있으면 짧게 나옵니다. 유통기한이 없는 재고뿐이면 '-' 입니다." />
                              </span>
                            </th>
                            <th className="px-1.5 py-1.5 font-bold">잔여율</th>
                            <th className="px-1.5 py-1.5 font-bold text-[#C62828]">소진필요</th>
                            <th className="px-1.5 py-1.5 font-bold">비중</th>
                            {detailBucketColumns.map((column, index) => (
                              <th
                                key={column.key}
                                className={`px-1.5 py-1.5 font-bold ${
                                  index === 0 ? 'border-l border-neutral-200' : ''
                                }`}
                                style={column.headColor ? { color: column.headColor } : undefined}
                              >
                                {column.key.startsWith('under50-') && (
                                  <span className="block text-[9px] font-normal text-neutral-400">
                                    50% 미만
                                  </span>
                                )}
                                {column.label}
                                <br />
                                <span className="font-normal text-neutral-400">수량 / 금액</span>
                              </th>
                            ))}
                            <th className="border-l border-neutral-200 px-1.5 py-1.5 font-bold">
                              주간 출고
                            </th>
                            <th className="px-1.5 py-1.5 font-bold">주간 생산</th>
                            <th className="px-1.5 py-1.5 font-bold">전월 출고 比</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailPageRows.map((row) => (
                            <tr
                              key={row.materialCode}
                              className="border-b border-neutral-100 hover:bg-neutral-50"
                            >
                              <td className="px-1.5 py-1.5 text-left font-mono text-[11px] text-neutral-500">
                                {row.materialCode}
                              </td>
                              {/*
                                품명 아래에 **반대 축**을 작게 붙인다.
                                팀별로 펼쳤으면 그 SKU 의 채널을, 채널별로 펼쳤으면 CM·카테고리를 보여
                                「이 냉동 재고 중 무엇이 B2B 인가」를 한 줄에서 대조할 수 있게 한다.
                              */}
                              <td
                                className="max-w-[220px] px-1.5 py-1.5 text-left font-medium text-neutral-800"
                                title={`${row.productName} · ${row.channel} · ${row.cm} ${row.category}`}
                              >
                                <span className="block truncate">{row.productName}</span>
                                <span className="mt-0.5 block truncate text-[9px] font-normal text-neutral-400">
                                  {drill.axis === 'all'
                                    ? `${row.cm} · ${row.category} · ${row.channel}`
                                    : axis === 'channel'
                                      ? `${row.cm} · ${row.category}`
                                      : `${row.channel}${row.lv2 ? ` · ${row.lv2}` : ''}`}
                                </span>
                              </td>
                              <td className="border-l border-neutral-100 px-1.5 py-1.5 tabular-nums text-neutral-600">
                                {Math.round(row.stockQty).toLocaleString('ko-KR')}
                                <span className="ml-0.5 text-[9px] text-neutral-400">{row.unit}</span>
                              </td>
                              <td className="px-1.5 py-1.5 font-semibold tabular-nums text-neutral-900">
                                {money(row.stockValue)}
                              </td>
                              <td
                                className={`px-1.5 py-1.5 tabular-nums ${
                                  row.stockDelta === null
                                    ? 'text-neutral-300'
                                    : row.stockDelta > 0
                                      ? 'text-[#1565C0]'
                                      : row.stockDelta < 0
                                        ? 'text-[#C62828]'
                                        : 'text-neutral-400'
                                }`}
                              >
                                {row.stockDelta === null ? '-' : moneyCell(row.stockDelta)}
                              </td>
                              <td
                                className={`border-l border-neutral-100 px-1.5 py-1.5 tabular-nums ${remainDayTone(
                                  row.minRemainDay
                                )}`}
                              >
                                {row.minRemainDay === null
                                  ? '-'
                                  : `${Math.round(row.minRemainDay).toLocaleString('ko-KR')}일`}
                              </td>
                              <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                                {row.avgRemainRate === null
                                  ? '-'
                                  : `${row.avgRemainRate.toFixed(0)}%`}
                              </td>
                              <td className="px-1.5 py-1.5 tabular-nums text-[#C62828]">
                                {moneyCell(row.riskValue)}
                              </td>
                              <td className="px-1.5 py-1.5">
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="h-1.5 w-9 overflow-hidden rounded-sm bg-neutral-100">
                                    <span
                                      className="block h-1.5 rounded-sm bg-[#D32F2F]"
                                      style={{
                                        width: `${Math.min(100, Math.round(row.riskRatio * 100))}%`,
                                      }}
                                    />
                                  </span>
                                  <span className="w-7 text-[10px] tabular-nums text-neutral-500">
                                    {Math.round(row.riskRatio * 100)}%
                                  </span>
                                </div>
                              </td>
                              {detailBucketColumns.map((column, index) => (
                                <td
                                  key={column.key}
                                  className={`px-1.5 py-1.5 tabular-nums ${column.tone} ${
                                    index === 0 ? 'border-l border-neutral-100' : ''
                                  }`}
                                >
                                  {bucketQuantityCell(
                                    column.quantityOf(row),
                                    column.valueOf(row),
                                    row.unit,
                                    column.availableOf(row)
                                  )}
                                </td>
                              ))}
                              <td className="border-l border-neutral-100 px-1.5 py-1.5 tabular-nums text-neutral-500">
                                {moneyCell(row.shippedValue)}
                              </td>
                              <td className="px-1.5 py-1.5 tabular-nums text-neutral-500">
                                {moneyCell(row.producedValue)}
                              </td>
                              <td className="px-1.5 py-1.5 tabular-nums text-neutral-600">
                                {percent(row.stockToPreviousMonthShipmentRatio)}
                              </td>
                            </tr>
                          ))}
                          {detailPageRows.length === 0 && (
                            <tr>
                              <td
                                colSpan={detailColumnCount}
                                className="py-6 text-center text-[11px] text-neutral-400"
                              >
                                조건에 맞는 품목이 없습니다.
                              </td>
                            </tr>
                          )}
                          <tr className="bg-[#FFF3E0] text-[11px] font-bold">
                            <td className="px-1.5 py-1.5 text-left" colSpan={2}>
                              합계 ({detail.totals.itemCount.toLocaleString('ko-KR')}품목)
                            </td>
                            <td className="border-l border-neutral-200 px-1.5 py-1.5 text-neutral-400">
                              단위혼재
                            </td>
                            <td className="px-1.5 py-1.5 tabular-nums">
                              {money(detail.totals.stockValue)}
                            </td>
                            <td className="px-1.5 py-1.5 tabular-nums">
                              {detail.hasPrevious
                                ? money(detail.totals.stockValue - detail.totals.previousStockValue)
                                : '-'}
                            </td>
                            <td className="border-l border-neutral-200 px-1.5 py-1.5" colSpan={2} />
                            <td className="px-1.5 py-1.5 tabular-nums text-[#C62828]">
                              {money(detail.totals.riskValue)}
                            </td>
                            <td className="px-1.5 py-1.5" />
                            {detailBucketColumns.map((column, index) => (
                              <td
                                key={column.key}
                                className={`px-1.5 py-1.5 tabular-nums ${
                                  column.headColor ? '' : 'text-neutral-600'
                                } ${index === 0 ? 'border-l border-neutral-200' : ''}`}
                                style={column.headColor ? { color: column.headColor } : undefined}
                              >
                                {money(column.total)}
                              </td>
                            ))}
                            <td className="border-l border-neutral-200 px-1.5 py-1.5 tabular-nums">
                              {money(detail.totals.shippedValue)}
                            </td>
                            <td className="px-1.5 py-1.5 tabular-nums">
                              {money(detail.totals.producedValue)}
                            </td>
                            <td className="px-1.5 py-1.5" />
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* 페이지네이션 */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
                      <span>
                        {detailRows.length.toLocaleString('ko-KR')}품목 중{' '}
                        {detailRows.length === 0 ? 0 : detailPageSafe * DETAIL_PAGE_SIZE + 1}–
                        {Math.min((detailPageSafe + 1) * DETAIL_PAGE_SIZE, detailRows.length)}
                        {' · '}
                        {DETAIL_SORTS.find((sort) => sort.key === detailSort)?.hint}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDetailPage((page) => Math.max(0, page - 1))}
                          disabled={detailPageSafe === 0}
                          className="rounded border border-neutral-200 p-1 disabled:opacity-30"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span className="tabular-nums">
                          {detailPageSafe + 1} / {detailPageCount}
                        </span>
                        <button
                          onClick={() =>
                            setDetailPage((page) => Math.min(detailPageCount - 1, page + 1))
                          }
                          disabled={detailPageSafe >= detailPageCount - 1}
                          className="rounded border border-neutral-200 p-1 disabled:opacity-30"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>

                    {!hasRemainDay && (
                      <p className="mt-1.5 text-[10px] text-amber-700">
                        이 주차는 소비기한 잔여일이 적재되지 않아 「소비기한 임박」 정렬을 쓸 수 없습니다.
                        재고는 소급 계산이 불가능해 과거 주차를 다시 채울 수 없고, 다음 적재부터 채워집니다.
                        그동안은 「소진필요 비중」으로 임박도를 대신 볼 수 있습니다.
                      </p>
                    )}
                    {detail.missingBucketQuantityCount > 0 && (
                      <p className="mt-1.5 text-[10px] text-amber-700">
                        {hasBucketQuantities
                          ? `구형 잔존 ${detail.missingBucketQuantityCount.toLocaleString('ko-KR')}개 품목은 구간 수량을 역산할 수 없어 수량만 '-'로 표시합니다.`
                          : '이 주차는 연령구간별 수량 열 추가 이전에 적재되어 수량만 비워 표시합니다.'}{' '}
                        금액은 기존 스냅샷 값을 그대로 표시합니다.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>

          {/* 2. 차트 + 구간별 주간 재고변동 */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 text-xs font-bold text-neutral-800">
                {axis === 'channel' ? '채널별' : '카테고리별'} 소비기한별 재고금액
                <span className="ml-1.5 font-normal text-neutral-400">억원</span>
              </h2>
              {segments.length > 0 ? (
                <CanvasStackedBarChart
                  labels={segments.map((entry) => entry.label)}
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
                <table
                  className={`w-full text-right text-xs ${
                    splitAvailable ? 'min-w-[720px]' : 'min-w-[560px]'
                  }`}
                >
                  <thead>
                    <tr className="bg-neutral-100 text-[11px] text-neutral-700">
                      <th className="px-1.5 py-1.5 text-center font-bold">구분</th>
                      {movementColumns.map((column) => (
                        <th
                          key={column.key}
                          className={`px-1.5 py-1.5 font-bold ${
                            column.subtotal ? 'border-r border-neutral-200 text-[#C62828]' : ''
                          }`}
                          style={column.color ? { color: column.color } : undefined}
                        >
                          {column.label}
                        </th>
                      ))}
                      <th className="px-1.5 py-1.5 font-bold">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-neutral-100">
                      <td className="px-1.5 py-1.5 text-center font-medium">
                        {meta?.labels.previousStock}
                      </td>
                      {movementColumns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-1.5 py-1.5 tabular-nums text-neutral-500 ${
                            column.subtotal ? 'border-r border-neutral-200 font-semibold' : ''
                          }`}
                        >
                          {column.split
                            ? board.movement.splitComparable
                              ? money(board.movement.splitPrevious[column.split])
                              : '-'
                            : moneyOrDash(board.movement.previous[column.bucket!], hasPrevious)}
                        </td>
                      ))}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums text-neutral-500">
                        {moneyOrDash(board.movement.previousTotal, hasPrevious)}
                      </td>
                    </tr>
                    <tr className="border-b border-neutral-100">
                      <td className="px-1.5 py-1.5 text-center font-medium">
                        {meta?.labels.currentStock}
                      </td>
                      {movementColumns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-1.5 py-1.5 tabular-nums ${
                            column.subtotal ? 'border-r border-neutral-200 font-semibold' : ''
                          }`}
                        >
                          {column.split
                            ? money(board.movement.splitCurrent[column.split])
                            : money(board.movement.current[column.bucket!])}
                        </td>
                      ))}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums">
                        {money(board.movement.currentTotal)}
                      </td>
                    </tr>
                    <tr className="border-b border-neutral-100 bg-[#FFF8E1]">
                      <td className="px-1.5 py-1.5 text-center font-medium">전주 比 증감액</td>
                      {movementColumns.map((column) => {
                        const available = column.split ? board.movement.splitComparable : hasPrevious;
                        const delta = column.split
                          ? board.movement.splitDelta[column.split]
                          : board.movement.delta[column.bucket!];
                        return (
                          <td
                            key={column.key}
                            className={`px-1.5 py-1.5 tabular-nums ${
                              !available
                                ? 'text-neutral-400'
                                : delta < 0
                                  ? 'text-[#C62828]'
                                  : 'text-[#1565C0]'
                            } ${column.subtotal ? 'border-r border-neutral-200 font-semibold' : ''}`}
                          >
                            {moneyOrDash(delta, available)}
                          </td>
                        );
                      })}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums">
                        {moneyOrDash(board.movement.deltaTotal, hasPrevious)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-1.5 py-1.5 text-center font-medium">전주 比 증감률</td>
                      {movementColumns.map((column) => {
                        let text = '-';
                        if (column.split) {
                          const previousValue = board.movement.splitPrevious[column.split];
                          if (board.movement.splitComparable && previousValue > 0) {
                            text = `${((board.movement.splitDelta[column.split] / previousValue) * 100).toFixed(1)}%`;
                          }
                        } else if (hasPrevious) {
                          text = `${(board.movement.rate[column.bucket!] * 100).toFixed(1)}%`;
                        }
                        return (
                          <td
                            key={column.key}
                            className={`px-1.5 py-1.5 tabular-nums ${
                              column.subtotal ? 'border-r border-neutral-200 font-semibold' : ''
                            }`}
                          >
                            {text}
                          </td>
                        );
                      })}
                      <td className="px-1.5 py-1.5 font-bold tabular-nums">
                        {hasPrevious ? `${(board.movement.rateTotal * 100).toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {board.movement.splitComparable &&
                (board.movement.splitEstimated || board.movement.splitPreviousEstimated) && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-700">
                    <EstimateBadge />
                    {board.movement.splitEstimated ? '당주' : '전주'} 0~20 · 20~40 · 40~50% 는 역산 추정치라
                    세부 증감에 추정 오차가 섞여 있습니다. 50% 미만 계는 실측입니다.
                  </p>
                )}
              {splitAvailable && !board.movement.splitComparable && hasPrevious && (
                <p className="mt-1 text-[10px] text-neutral-400">
                  전주는 세부 구간 적재 이전이라 0~20 · 20~40 · 40~50% 증감은 비워 둡니다. 50% 미만 계는 비교할 수 있습니다.
                </p>
              )}

              <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-neutral-200 bg-neutral-50 p-2.5 font-sans text-[11px] leading-relaxed text-neutral-700">
                {meta?.notes.bucket}
              </pre>
            </section>
          </div>

          {/*
            2-1. 50% 미만 세부 구간 — 「내부소진」 한 덩어리를 임박도로 쪼개 무엇부터 처분할지 보여준다.
            새 조회 없이 메인 표와 같은 board 값만 쓴다(카드 합 = 메인 표 50% 미만 합계).
          */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 flex items-center gap-1 text-xs font-bold text-neutral-800">
                50% 미만 세부 구간
                <span className="font-normal text-neutral-400">
                  {axis === 'channel' ? '채널별' : '카테고리별'} · 0~20 / 20~40 / 40~50%
                </span>
                <InfoTooltip text={UNDER50_HINT} />
                {splitEstimated && <EstimateBadge />}
              </h2>
              {splitAvailable ? (
                <>
                  <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {board.under50Summary.map((item) => {
                      const color = UNDER50_COLORS[item.key];
                      const share =
                        board.totals.stockValue > 0 ? (item.value / board.totals.stockValue) * 100 : 0;
                      const delta = board.movement.splitDelta[item.key];
                      return (
                        <div
                          key={item.key}
                          className="rounded-md border border-neutral-200 p-2"
                          style={{ borderLeft: `3px solid ${color}` }}
                        >
                          <div className="text-[11px] font-bold" style={{ color }}>
                            잔여율 {WEEKLY_UNDER50_LABELS[item.key]}
                          </div>
                          <div className="mt-0.5 text-lg font-bold tabular-nums text-neutral-900">
                            {toEok(item.value).toFixed(1)}
                            <span className="ml-0.5 text-[11px] font-medium text-neutral-500">억</span>
                          </div>
                          <div className="text-[10px] tabular-nums text-neutral-500">
                            재고의 {share.toFixed(1)}% · {item.itemCount.toLocaleString('ko-KR')}품목
                          </div>
                          <div
                            className={`text-[10px] tabular-nums ${
                              !board.movement.splitComparable
                                ? 'text-neutral-300'
                                : delta > 0
                                  ? 'text-[#C62828]'
                                  : 'text-[#1565C0]'
                            }`}
                          >
                            전주 比{' '}
                            {board.movement.splitComparable ? formatSignedNoteAmount(delta) : '-'}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 줄별 세부 구간 막대 — 길이는 50% 미만 금액, 색은 그 안의 임박도. 누르면 위 상세가 그 줄로 열린다 */}
                  <div className="space-y-1">
                    {segments
                      .filter((entry) => Math.round(entry.buckets.under50) > 0)
                      .map((entry) => {
                        const under20Share =
                          entry.buckets.under50 > 0
                            ? (entry.under50Split.under20 / entry.buckets.under50) * 100
                            : 0;
                        return (
                          <button
                            key={entry.key}
                            onClick={() => handleRiskSelect(entry.key)}
                            title={WEEKLY_UNDER50_KEYS.map(
                              (key) =>
                                `${WEEKLY_UNDER50_LABELS[key]} ${formatNoteAmount(entry.under50Split[key])}`
                            ).join(' · ')}
                            className={`flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-neutral-50 ${
                              selectedRiskKey === entry.key ? 'bg-[#E3F2FD]/60' : ''
                            }`}
                          >
                            <span className="w-16 shrink-0 truncate text-[11px] font-medium text-neutral-700">
                              {entry.label}
                            </span>
                            <span className="flex h-3.5 flex-1 overflow-hidden rounded-sm bg-neutral-100">
                              {WEEKLY_UNDER50_KEYS.map((key) => (
                                <span
                                  key={key}
                                  className="block h-full"
                                  style={{
                                    width: `${(entry.under50Split[key] / under50AxisMax) * 100}%`,
                                    backgroundColor: UNDER50_COLORS[key],
                                  }}
                                />
                              ))}
                            </span>
                            <span className="w-28 shrink-0 text-right text-[10px] tabular-nums text-neutral-500">
                              <b className="text-neutral-800">{formatNoteAmount(entry.buckets.under50)}</b>
                              {' · '}
                              <span className="text-[#7F0000]">20%↓ {Math.round(under20Share)}%</span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                    {WEEKLY_UNDER50_KEYS.map((key) => (
                      <span key={key} className="flex items-center gap-1 text-[11px] text-neutral-600">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: UNDER50_COLORS[key] }}
                        />
                        {WEEKLY_UNDER50_LABELS[key]}
                      </span>
                    ))}
                    <span className="text-[10px] text-neutral-400">
                      한 품목이 여러 구간에 걸칠 수 있어 품목 수의 합은 전체 품목 수보다 클 수 있습니다
                    </span>
                  </div>
                </>
              ) : (
                <p className="rounded-md border border-dashed border-amber-200 bg-amber-50/50 px-3 py-6 text-center text-[11px] leading-relaxed text-amber-800">
                  이 주차는 50% 미만 세부 구간(0~20 · 20~40 · 40~50%)을 적재하기 전에 찍혀 나눌 수 없습니다.
                  <br />
                  재고는 소급 계산이 불가능해 지난 주차는 다시 채울 수 없고, 다음 적재부터 나뉩니다.
                  {isAdmin && ' 진행 중인 주차를 고르고 「적재」를 누르면 지금 재고로 바로 확인할 수 있습니다.'}
                </p>
              )}
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 flex items-center gap-1 text-xs font-bold text-neutral-800">
                잔여율 20% 미만 재고 상위 품목
                <span className="font-normal text-neutral-400">
                  처분 판단 우선순위 · 상위 {board.criticalItems.length}
                </span>
                <InfoTooltip text="소비기한 잔여율 0~20% 재고금액이 큰 SKU 입니다(기한이 이미 지난 배치 포함). 잔여일은 그 SKU 에서 가장 임박한 배치 기준입니다. 품목을 누르면 위 상세 보기가 전체 목록 · 20% 미만 금액순으로 열리고 그 품목이 검색됩니다." />
                {splitEstimated && <EstimateBadge label="역산 추정 · 품목별 오차 큼" />}
                {splitAvailable && board.criticalItems.length > 0 && (
                  <button
                    onClick={() => openCriticalDetail()}
                    className="ml-auto rounded-md border border-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-50"
                  >
                    전체 품목에서 보기
                  </button>
                )}
              </h2>
              {!splitAvailable ? (
                <p className="py-8 text-center text-[11px] text-neutral-400">
                  세부 구간이 적재된 주차부터 표시됩니다.
                </p>
              ) : board.criticalItems.length === 0 ? (
                <p className="py-8 text-center text-[11px] text-neutral-400">
                  잔여율 20% 미만 재고가 없습니다.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-right text-xs">
                    <thead>
                      <tr className="bg-neutral-100 text-[10px] text-neutral-600">
                        <th className="px-1.5 py-1.5 text-left font-bold">품목</th>
                        <th className="px-1.5 py-1.5 text-left font-bold">
                          {axis === 'channel' ? '채널' : '구분'}
                        </th>
                        <th className="px-1.5 py-1.5 font-bold" style={{ color: UNDER50_COLORS.under20 }}>
                          0~20%
                        </th>
                        <th className="px-1.5 py-1.5 font-bold text-[#C62828]">50% 미만</th>
                        <th className="px-1.5 py-1.5 font-bold">재고금액</th>
                        <th className="px-1.5 py-1.5 font-bold">잔여일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.criticalItems.map((item) => (
                        <tr
                          key={item.materialCode}
                          onClick={() => openCriticalDetail(item.materialCode)}
                          title={`${item.productName} 상세 보기`}
                          className="cursor-pointer border-b border-neutral-100 hover:bg-[#E3F2FD]/40"
                        >
                          <td className="max-w-[200px] px-1.5 py-1.5 text-left">
                            <span className="block truncate font-medium text-neutral-800">
                              {item.productName}
                            </span>
                            <span className="block font-mono text-[9px] text-neutral-400">
                              {item.materialCode}
                            </span>
                          </td>
                          <td className="px-1.5 py-1.5 text-left text-[11px] text-neutral-500">
                            {item.group}
                          </td>
                          <td
                            className="px-1.5 py-1.5 font-bold tabular-nums"
                            style={{ color: UNDER50_COLORS.under20 }}
                          >
                            {money(item.under20)}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-[#C62828]">
                            {money(item.under50)}
                          </td>
                          <td className="px-1.5 py-1.5 tabular-nums text-neutral-600">
                            {money(item.stockValue)}
                          </td>
                          <td className={`px-1.5 py-1.5 tabular-nums ${remainDayTone(item.minRemainDay)}`}>
                            {item.minRemainDay === null
                              ? '-'
                              : `${Math.round(item.minRemainDay).toLocaleString('ko-KR')}일`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* 3-0. 한시 매핑으로 자리를 잡은 재고 — 기준정보가 아니라 손으로 적은 값임을 숨기지 않는다 */}
          {axis === 'team' && teamBoard && teamBoard.overrideMapped.itemCount > 0 && (
            <section className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-[11px] text-sky-900">
              <h2 className="mb-1 flex items-center gap-1 text-xs font-bold">
                <Info size={13} />
                임시 카테고리 매핑 적용 중
              </h2>
              DISPO(생산 라인 코드)가 아직 없는 SKU {teamBoard.overrideMapped.itemCount}품목 ·{' '}
              <b>{formatNoteAmount(teamBoard.overrideMapped.value)}</b> 은 사업부 확인 목록으로 CM·공장·카테고리를
              배정했습니다. 기준정보가 정비돼 DISPO 가 붙으면 그 값이 자동으로 우선합니다.
            </section>
          )}

          {/* 3. 카테고리 축에 못 담긴 재고 — 매핑 누락을 금액으로 드러낸다 */}
          {axis === 'team' && teamBoard && teamBoard.unmappedDispo.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <h2 className="mb-1.5 flex items-center gap-1 text-xs font-bold text-amber-900">
                <AlertTriangle size={13} />
                카테고리 미매핑 (DISPO)
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {teamBoard.unmappedDispo.slice(0, 12).map((entry) => (
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
          {/* 3-1. 채널 축에 못 담긴 재고 — 팀별 축의 「미매핑」과 같은 역할이다 */}
          {axis === 'channel' && channelBoard && channelBoard.unmappedLv2.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <h2 className="mb-1.5 flex items-center gap-1 text-xs font-bold text-amber-900">
                <AlertTriangle size={13} />
                채널 미매핑 (제품계층 LV2)
                <InfoTooltip text="제품계층 2레벨 값이 채널 매핑표(lib/weekly/channel.ts)에 없는 재고입니다. 표에 줄을 더하면 다시 적재하지 않아도 과거 주차까지 함께 옮겨갑니다." />
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {channelBoard.unmappedLv2.slice(0, 12).map((entry) => (
                  <span
                    key={entry.lv2}
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900"
                  >
                    <b>{entry.lv2}</b> {formatNoteAmount(entry.value)} · {entry.itemCount}품목
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* 3-2. 제품계층 마스터에 아예 없는 SKU — 매핑 누락과 원인이 다르므로 따로 알린다 */}
          {axis === 'channel' && channelBoard && channelBoard.missingHierarchy.itemCount > 0 && (
            <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] text-neutral-700">
              <h2 className="mb-1 flex items-center gap-1 text-xs font-bold text-neutral-800">
                <Info size={13} />
                제품계층 마스터 없음
              </h2>
              {channelBoard.missingHierarchy.itemCount}품목 ·{' '}
              <b>{formatNoteAmount(channelBoard.missingHierarchy.value)}</b> 은 자재마스터(SD_MARA)에
              제품계층이 없어 채널을 판정하지 못했습니다. 매핑 누락이 아니라 기준정보 자체가 비어 있는
              경우입니다{isAdmin ? ' — 「제품계층 갱신」을 눌러 마스터를 다시 받아보세요.' : '.'}
            </section>
          )}

          {/*
            4. 요약 차트 — 새 조회 없이 위에서 이미 계산된 값만 다시 그린다.
            브리지는 메인 표 합계행(totals), 순위는 누적막대(segments)와 같은 원천이라 숫자가 갈릴 수 없다.
            두 축이 같은 totals 를 쓰므로 브리지는 탭을 바꿔도 같은 그림이어야 정상이다.
          */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 flex items-center gap-1 text-xs font-bold text-neutral-800">
                이번 주 재고는 왜 변했나
                <InfoTooltip text="전주 재고에서 출발해 생산(+)·출고(−)·기타(대차 차이)를 쌓으면 금주 재고가 됩니다. 막대는 0(전주 재고) 기준 증감만 그립니다. 금액은 전부 원가팀 기말재고 단가입니다." />
              </h2>
              <WeeklyFlowBridge
                previousStockValue={board.totals.previousStockValue}
                producedValue={board.totals.producedValue}
                shippedValue={board.totals.shippedValue}
                stockValue={board.totals.stockValue}
                balanceGap={board.totals.balanceGap}
                hasPrevious={hasPrevious}
                provisional={isProvisionalWeek}
              />
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white p-3">
              <h2 className="mb-2 flex items-center gap-1 text-xs font-bold text-neutral-800">
                소진필요 재고 순위
                <span className="font-normal text-neutral-400">
                  {axis === 'channel' ? '채널별' : '카테고리별'} · 잔여율 75% 미만
                </span>
                <InfoTooltip text="막대는 소진필요(잔여율 75% 미만) 재고금액, 옆 %는 그 줄 재고 중 소진필요 비중입니다. 누르면 위 「상세 보기」가 그 줄의 SKU 로 열립니다." />
              </h2>
              <SalesRankBars
                items={riskRankItems}
                color={BUCKET_COLORS.r50_70}
                emptyText="소진필요 재고가 없습니다."
                onSelect={handleRiskSelect}
                selectedKey={selectedRiskKey}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
