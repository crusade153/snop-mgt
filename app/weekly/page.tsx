// app/weekly/page.tsx
// 주간 완제품 재고 요약장표 — 수기 엑셀 「1. 완제품 재고현황」을 대체한다.
// 계산은 lib/weekly/board.ts 순수 함수에 있고 여기서는 표시·필터만 한다.
// 데이터는 주 1회 적재된 Supabase 스냅샷에서만 온다(BigQuery 를 때리지 않는다).
'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { exportToExcel } from '@/lib/excel-export';
import InfoTooltip from '@/components/info-tooltip';
import {
  WEEKLY_BUCKET_KEYS,
  WEEKLY_BUCKET_LABELS,
  WEEKLY_RISK_BUCKET_KEYS,
  formatNoteAmount,
  toEok,
  type WeeklyBoardMetrics,
  type WeeklyBuckets,
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

/** 펼친 칸. 축마다 좌표가 다르다 */
type Drill =
  | { axis: 'team'; cm: WeeklyCm | null; category: WeeklyCategory }
  | { axis: 'channel'; channel: WeeklyChannel };

const drillKey = (drill: Drill) =>
  drill.axis === 'channel' ? `channel:${drill.channel}` : `team:${drill.cm ?? 'ALL'}:${drill.category}`;

const drillLabel = (drill: Drill) =>
  drill.axis === 'channel'
    ? drill.channel
    : `${drill.cm ? `${drill.cm} · ` : ''}${drill.category}`;

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
type DetailSortKey = 'stockValue' | 'riskValue' | 'riskRatio' | 'remain' | 'shipped' | 'ratio' | 'delta';

const DETAIL_SORTS: { key: DetailSortKey; label: string; hint: string }[] = [
  { key: 'stockValue', label: '재고금액', hint: '재고금액이 큰 순' },
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

  // 주차를 바꾸거나 축을 바꾸면 펼쳐 둔 상세는 좌표가 다른 것이라 닫는다.
  useEffect(() => {
    setDrill(null);
  }, [activeWeek, axis]);

  // 상세는 행을 눌렀을 때만 부른다. 첫 화면 로딩에는 영향이 없다.
  const { data: detailData, isFetching: detailLoading } = useQuery({
    queryKey: ['weekly-detail', activeWeek, drill ? drillKey(drill) : 'none'],
    queryFn: () => {
      const target = drill!;
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

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (detailSort) {
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
  }, [detail, detailSort, detailQuery]);

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

    exportToExcel(
      detailRows.map((row) => ({
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
        ...WEEKLY_BUCKET_KEYS.reduce<Record<string, number | null>>((acc, key) => {
          const name = WEEKLY_BUCKET_LABELS[key].split(' [')[0];
          // 구간 수량은 열이 없던 주차에서 0 으로 채워져 있다. 0 과 「모름」을 섞지 않는다.
          acc[`${name} 수량`] = row.hasBucketQuantities ? Math.round(row.bucketQuantities[key]) : null;
          acc[`${name} 금액`] = Math.round(row.buckets[key]);
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
        total: entry.total,
        drill: { axis: 'channel', channel: entry.channel } as Drill,
      }));
    }
    return (teamBoard?.categoryBuckets ?? []).map((entry) => ({
      key: entry.category as string,
      label: entry.category as string,
      buckets: entry.buckets,
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

  const chartSeries = useMemo(
    () =>
      WEEKLY_BUCKET_KEYS.map((key) => ({
        label: WEEKLY_BUCKET_LABELS[key],
        color: BUCKET_COLORS[key],
        emphasis: RISK_BUCKET_KEYS.includes(key),
        values: segments.map((entry) => toEok(entry.buckets[key])),
      })),
    [segments]
  );

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
                    axis === 'channel' ? 'min-w-[1000px]' : 'min-w-[1120px]'
                  }`}
                >
                  <thead>
                    {/* 열이 많아 그룹 머리행으로 흐름·연령·재고 지표 경계를 고정한다. */}
                    <tr className="bg-neutral-100 text-[10px] text-neutral-500">
                      <th
                        className="px-1.5 pt-1.5 text-center font-bold"
                        colSpan={groupColCount}
                        rowSpan={2}
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
                        colSpan={5}
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
                      <th className="border-l border-neutral-200 px-1.5 pb-1.5 font-bold">
                        {meta?.labels.previousStock}
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
                        {meta?.labels.currentStock}
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold">
                        <span className="flex items-center justify-end gap-1">
                          소진 필요
                          <InfoTooltip text="소비기한 잔여율 75% 미만(50% 미만 + 50~70% + 70~75%) 재고금액과 그 비중입니다. 이 비중이 높은 행부터 소진 계획이 필요합니다." />
                        </span>
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold">
                        <span className="flex items-center justify-end gap-1">
                          전월 출고 比
                          <InfoTooltip text="현재 재고금액 ÷ 직전 달 1일~말일 출고금액입니다. 출고금액도 재고와 똑같이 완제품 재고단가로 환산하므로, 200%는 '전월 한 달 출고량의 2배를 쌓아두고 있다'로 읽습니다. 완료된 한 달을 분모로 써 월초에도 비율이 흔들리지 않습니다." />
                        </span>
                        재고금액
                      </th>
                      <th className="px-1.5 pb-1.5 font-bold">
                        <span className="flex items-center justify-end gap-1">
                          전월 매출 比
                          <InfoTooltip text="현재 재고금액 ÷ 직전 달 1일~말일 실제 납품매출액(NETWR)입니다. 완료된 전월 매출과 현재 재고자산을 비교해 현금 흐름 부담을 판단합니다." />
                        </span>
                        재고금액
                      </th>
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
          <section className="rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-100 px-3 py-2">
              <span className="text-[11px] font-bold text-neutral-500">상세 보기</span>
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
                재고수량·금액·소비기한이 펼쳐집니다.
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
                  </h2>

                  {/* 정렬 — 금액 기준과 소비기한 임박 기준을 나란히 둔다 */}
                  <div className="flex flex-wrap items-center gap-1">
                    {DETAIL_SORTS.map((sort) => {
                      // 잔여일 열이 없는 주차에서 「소비기한 임박」을 누르면 정렬이 무의미해진다. 아예 막는다.
                      const disabled =
                        (sort.key === 'remain' && !hasRemainDay) ||
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
                      <table className="w-full min-w-[1480px] text-right text-xs">
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
                            {WEEKLY_BUCKET_KEYS.map((key, index) => (
                              <th
                                key={key}
                                className={`px-1.5 py-1.5 font-bold ${
                                  index === 0 ? 'border-l border-neutral-200' : ''
                                } ${RISK_BUCKET_KEYS.includes(key) ? 'text-[#C62828]' : ''}`}
                              >
                                {WEEKLY_BUCKET_LABELS[key].split(' [')[0]}
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
                                  {axis === 'channel'
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
                              {WEEKLY_BUCKET_KEYS.map((key, index) => (
                                <td
                                  key={key}
                                  className={`px-1.5 py-1.5 tabular-nums ${BUCKET_CELL_TONE[key]} ${
                                    index === 0 ? 'border-l border-neutral-100' : ''
                                  }`}
                                >
                                  {bucketQuantityCell(
                                    row.bucketQuantities[key],
                                    row.buckets[key],
                                    row.unit,
                                    row.hasBucketQuantities
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
                              <td colSpan={17} className="py-6 text-center text-[11px] text-neutral-400">
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
                            {WEEKLY_BUCKET_KEYS.map((key, index) => (
                              <td
                                key={key}
                                className={`px-1.5 py-1.5 tabular-nums ${
                                  RISK_BUCKET_KEYS.includes(key) ? 'text-[#C62828]' : 'text-neutral-600'
                                } ${index === 0 ? 'border-l border-neutral-200' : ''}`}
                              >
                                {money(detail.totals.buckets[key])}
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
                        {meta?.labels.previousStock}
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
                        {meta?.labels.currentStock}
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
                {meta?.notes.bucket}
              </pre>
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
        </>
      )}
    </div>
  );
}
