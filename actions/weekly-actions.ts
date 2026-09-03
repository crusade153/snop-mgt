'use server';

/**
 * 주간 요약장표 조회
 *
 * ⚠️ 이 액션은 **BigQuery 를 읽지 않는다.** 주 1회 적재해 둔 Supabase 스냅샷만 읽으므로
 * 화면을 아무리 새로고침해도 BigQuery 비용이 발생하지 않는다.
 * 계산은 전부 `lib/weekly/board.ts` 순수 함수에 있고 여기는 실행·조립만 한다.
 */

import { unstable_cache, updateTag } from 'next/cache';
import { createAdminSupabaseClient, getAdminContext } from '@/lib/admin-auth';
import {
  buildBucketMovementNote,
  buildStockSummaryNote,
  buildWeeklyBoard,
  buildWeeklyDetail,
  type WeeklyBoardResult,
  type WeeklyDetailResult,
  type WeeklySnapshotRow,
} from '@/lib/weekly/board';
import type { WeeklyCategory, WeeklyCm, WeeklyStorageScope } from '@/lib/weekly/classification';
import { isConsecutiveWeek, rangeLabel, seoulToday, shortDateLabel, weekRangeOf } from '@/lib/weekly/week';

export interface WeeklyBoardPayload {
  success: boolean;
  message?: string;
  /** 적재된 주차 목록 (최신순) */
  weeks: string[];
  weekEnd: string | null;
  previousWeekEnd: string | null;
  /** 직전 주차가 실제로 1주 전인지. 아니면 "전주 대비"를 비워야 한다 */
  hasComparable: boolean;
  labels: {
    title: string;
    previousStock: string;
    flow: string;
    currentStock: string;
  };
  board: WeeklyBoardResult | null;
  notes: {
    stock: string;
    bucket: string;
    issue: string;
  };
  /** 관리자가 덮어쓴 문구가 있는 섹션 */
  overriddenNoteSections: string[];
  unpricedItemCount: number;
  /**
   * 이 주차 재고를 실제로 찍은 시각(ISO).
   *
   * `/stock` 은 지금 재고를 보여주고 이 장표는 적재 순간의 재고를 보여준다. 같은 기준·같은 쿼리를 쓰므로
   * **적재 순간에는 두 화면의 재고금액이 원 단위까지 일치**하고, 이후 벌어지는 차이는 전부 시간차다.
   * 그 시간차를 사용자가 직접 볼 수 있게 화면에 노출한다.
   */
  capturedAt: string | null;
}

const EMPTY: WeeklyBoardPayload = {
  success: false,
  weeks: [],
  weekEnd: null,
  previousWeekEnd: null,
  hasComparable: false,
  labels: { title: '', previousStock: '', flow: '', currentStock: '' },
  board: null,
  notes: { stock: '', bucket: '', issue: '' },
  overriddenNoteSections: [],
  unpricedItemCount: 0,
  capturedAt: null,
};

async function loadSnapshotRows(weekEnd: string): Promise<WeeklySnapshotRow[]> {
  const supabase = createAdminSupabaseClient();
  const rows: WeeklySnapshotRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('snop_weekly_inventory_snapshots')
      .select('*')
      .eq('week_end_date', weekEnd)
      .order('material_code')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`주간 스냅샷 조회 실패: ${error.message}`);
    rows.push(...((data || []) as WeeklySnapshotRow[]));
    if ((data || []).length < pageSize) return rows;
  }
}

/** 이 주차 행이 실제로 적재된 시각. 가장 늦게 쓰인 행 기준이다. */
async function loadCapturedAt(weekEnd: string): Promise<string | null> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('snop_weekly_inventory_snapshots')
    .select('created_at')
    .eq('week_end_date', weekEnd)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0]?.created_at ? String(data[0].created_at) : null;
}

async function loadCmMapping(): Promise<Map<string, WeeklyCm>> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from('snop_cm_mapping').select('material_code, cm_code');
  // 매핑은 아직 없을 수 있다. 없으면 카테고리 기본값으로 떨어지므로 화면을 막지 않는다.
  if (error) {
    console.warn('⚠️ CM 매핑 조회 실패, 카테고리 기본값으로 진행합니다:', error.message);
    return new Map();
  }
  return new Map((data || []).map((row) => [String(row.material_code), row.cm_code as WeeklyCm]));
}

async function loadNotes(weekEnd: string) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('snop_weekly_board_notes')
    .select('section, body')
    .eq('week_end_date', weekEnd);
  if (error) {
    console.warn('⚠️ 비고 문구 조회 실패:', error.message);
    return new Map<string, string>();
  }
  return new Map((data || []).map((row) => [String(row.section), String(row.body)]));
}

/**
 * 적재된 주차 목록 (최신순).
 *
 * ⚠️ **한 번에 긁어서 `new Set` 으로 distinct 를 만들면 안 된다.**
 * PostgREST 는 `.limit(2000)` 을 줘도 서버 상한(max-rows = 1000)에서 응답을 자른다.
 * 이 테이블은 **주차 하나가 2천 행이 넘어서**(실측 2026-08-30 = 2,103행, 08-23 = 2,135행)
 * 1000행을 다 최신 주차가 채워 버리고, 그 결과 주차 목록에 최신 한 주차만 남았다.
 * → `priorWeek` 가 null → `hasComparable` false → 전주 재고·전주 比 증감이 통째로 빈칸이 됐다.
 *
 * 그래서 주차 하나씩 커서로 내려가며 distinct 를 만든다(주차당 1행씩만 읽으므로 가볍다).
 * 화면 드롭다운과 「전주」 비교에 필요한 만큼만 가져온다.
 */
async function loadWeeks(limit = 26): Promise<string[]> {
  const supabase = createAdminSupabaseClient();
  const weeks: string[] = [];
  let cursor: string | null = null;

  for (let step = 0; step < limit; step += 1) {
    let query = supabase
      .from('snop_weekly_inventory_snapshots')
      .select('week_end_date')
      .order('week_end_date', { ascending: false })
      .limit(1);
    if (cursor) query = query.lt('week_end_date', cursor);

    const { data, error } = await query;
    if (error) throw new Error(`주차 목록 조회 실패: ${error.message}`);

    const week = data?.[0]?.week_end_date ? String(data[0].week_end_date) : null;
    if (!week) break;
    weeks.push(week);
    cursor = week;
  }

  return weeks;
}

async function buildPayload(
  weekEnd: string | null,
  scopes: WeeklyStorageScope[]
): Promise<WeeklyBoardPayload> {
  const weeks = await loadWeeks();
  if (weeks.length === 0) {
    return {
      ...EMPTY,
      success: true,
      message:
        '아직 적재된 주차가 없습니다. 첫 주간 스냅샷이 쌓이면 표가 채워집니다(월요일 새벽 자동 적재).',
    };
  }

  const targetWeek = weekEnd && weeks.includes(weekEnd) ? weekEnd : weeks[0];
  const priorWeek = weeks.find((week) => week < targetWeek) || null;
  const hasComparable = !!priorWeek && isConsecutiveWeek(priorWeek, targetWeek);

  // 연속하지 않은 주차를 「전주」로 쓰면 증감이 엉뚱해진다. 비교 가능할 때만 불러온다.
  const [current, previous, cmMapping, notes, capturedAt] = await Promise.all([
    loadSnapshotRows(targetWeek),
    hasComparable && priorWeek ? loadSnapshotRows(priorWeek) : Promise.resolve([]),
    loadCmMapping(),
    loadNotes(targetWeek),
    loadCapturedAt(targetWeek),
  ]);

  const board = buildWeeklyBoard({ current, previous, cmMapping, scopes });
  const range = weekRangeOf(targetWeek);

  return {
    success: true,
    weeks,
    weekEnd: targetWeek,
    previousWeekEnd: priorWeek,
    hasComparable,
    labels: {
      title: `완제품 재고현황 (${shortDateLabel(targetWeek)} 기준)`,
      previousStock: hasComparable && priorWeek ? `${shortDateLabel(priorWeek)} 재고` : '전주 재고',
      flow: rangeLabel(range),
      currentStock: `${shortDateLabel(targetWeek)} 재고`,
    },
    board,
    notes: {
      stock: notes.get('stock') || buildStockSummaryNote(board),
      bucket: notes.get('bucket') || buildBucketMovementNote(board.movement, board.hasPrevious),
      issue: notes.get('issue') || '',
    },
    overriddenNoteSections: [...notes.keys()],
    unpricedItemCount: current.filter((row) => row.price_source !== 'ENDING_INVENTORY').length,
    capturedAt,
  };
}

/**
 * 주간 장표 데이터.
 *
 * ⚠️ **기본 스코프는 `/stock` 의 「통합 재고」와 정확히 같아야 한다** — 플랜트 + 물류(FBH).
 * 두 화면의 재고금액이 어긋나면 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
 * 기타 창고는 지금까지 어느 화면에도 안 잡히던 재고라 **켜서 볼 수 있는 옵션**으로만 둔다.
 *
 * 적재가 주 1회라 캐시를 길게 잡아도 안전하다. 수동 적재 후에는 `report-data` 태그로 무효화된다.
 */
export async function getWeeklyBoard(
  weekEnd?: string,
  scopes: WeeklyStorageScope[] = ['PLANT', 'LOGISTICS']
): Promise<WeeklyBoardPayload> {
  try {
    return await unstable_cache(
      () => buildPayload(weekEnd || null, scopes),
      // v12: 자재코드 6 대역을 DISPO 보다 앞서 상품으로 본다 + DISPO 없는 SKU 의 한시 매핑표.
      //      (v10 = 18=즉석밥·H01 폴백, v9 = 75% 미만 소진 기준·월 매출 比, v8 = 주차 목록 1000행 상한)
      [`weekly-board-v12-merchandise-band-${weekEnd || 'latest'}-${[...scopes].sort().join('+')}`],
      { revalidate: 600, tags: ['report-data'] }
    )();
  } catch (error) {
    const raw = error instanceof Error ? error.message : '주간 장표를 불러오지 못했습니다.';
    // 첫 배포 때 반드시 한 번 만나는 상태다. 원문 대신 무엇을 해야 하는지 알려준다.
    const missingTable = raw.includes('snop_weekly_inventory_snapshots') && /find the table|does not exist/i.test(raw);
    return {
      ...EMPTY,
      message: missingTable
        ? '주간 스냅샷 테이블이 아직 없습니다. Supabase 대시보드에서 supabase/weekly-summary-board.sql 을 실행해 주세요.'
        : raw,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 카테고리 드릴다운                                                     */
/* ------------------------------------------------------------------ */

export interface WeeklyDetailPayload {
  success: boolean;
  message?: string;
  weekEnd: string | null;
  previousWeekEnd: string | null;
  category: WeeklyCategory | null;
  cm: WeeklyCm | null;
  detail: WeeklyDetailResult | null;
}

/**
 * 메인 표 한 칸을 SKU 단위로 펼친다.
 *
 * ⚠️ **메인 표와 같은 스냅샷·같은 판정 함수를 쓴다.** 여기서만 다른 필터를 걸면 상세 합계가
 * 위 표의 그 줄과 어긋나 사용자가 어느 쪽을 믿어야 할지 알 수 없게 된다.
 *
 * 행이 눌릴 때만 부르므로 첫 화면 로딩을 무겁게 하지 않는다.
 * 캐시는 메인 표와 같은 `report-data` 태그를 달아 적재 직후 함께 갈린다.
 */
export async function getWeeklyCategoryDetail(
  weekEnd: string,
  category: WeeklyCategory | null,
  cm: WeeklyCm | null = null,
  scopes: WeeklyStorageScope[] = ['PLANT', 'LOGISTICS']
): Promise<WeeklyDetailPayload> {
  try {
    return await unstable_cache(
      async () => {
        const weeks = await loadWeeks();
        if (!weeks.includes(weekEnd)) {
          return {
            success: false,
            message: '적재되지 않은 주차입니다.',
            weekEnd: null,
            previousWeekEnd: null,
            category,
            cm,
            detail: null,
          } satisfies WeeklyDetailPayload;
        }

        const priorWeek = weeks.find((week) => week < weekEnd) || null;
        const comparable = !!priorWeek && isConsecutiveWeek(priorWeek, weekEnd);

        const [current, previous, cmMapping] = await Promise.all([
          loadSnapshotRows(weekEnd),
          comparable && priorWeek ? loadSnapshotRows(priorWeek) : Promise.resolve([]),
          loadCmMapping(),
        ]);

        return {
          success: true,
          weekEnd,
          previousWeekEnd: comparable ? priorWeek : null,
          category,
          cm,
          detail: buildWeeklyDetail({ current, previous, cmMapping, scopes, category, cm }),
        } satisfies WeeklyDetailPayload;
      },
      [
        // v5: 메인 표와 같은 분류(6 대역 상품 + 한시 매핑)가 상세에도 그대로 걸린다.
        `weekly-detail-v5-merchandise-band-${weekEnd}-${category || 'ALL'}-${cm || 'ALL'}-${[...scopes]
          .sort()
          .join('+')}`,
      ],
      { revalidate: 600, tags: ['report-data'] }
    )();
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '상세 내역을 불러오지 못했습니다.',
      weekEnd: null,
      previousWeekEnd: null,
      category,
      cm,
      detail: null,
    };
  }
}

export interface CaptureActionResult {
  ok: boolean;
  message: string;
}

/**
 * 관리자 수동 적재.
 *
 * cron 을 기다리지 않고 지금 화면을 채우고 싶을 때 쓴다.
 * 인자 없이 부르면 **진행 중인 이번 주**를 잠정치로 적재한다(재고=지금 재고, 출고·생산=주중 누계).
 *
 * ⚠️ `/weekly` 는 로그인 사용자 전원에게 열려 있지만 적재는 관리자만 할 수 있다.
 * 사이드바 숨김은 클라이언트 처리라 믿을 수 없으므로 여기서 `getAdminContext()` 로 다시 확인한다.
 */
export async function captureWeeklySnapshotAction(weekEnd?: string): Promise<CaptureActionResult> {
  const context = await getAdminContext();
  if (!context.isAdmin) {
    return { ok: false, message: context.reason || '관리자만 적재할 수 있습니다.' };
  }

  // 인자가 없으면 진행 중인 이번 주를 잡는다(cron 은 반대로 "직전에 끝난 주"를 적재한다).
  const target = weekEnd || weekRangeOf(seoulToday()).weekEnd;

  try {
    // 적재 모듈은 BigQuery 싱글톤을 물고 있어 무겁다. 버튼을 누를 때만 끌어온다.
    const { captureWeeklySnapshot } = await import('@/lib/weekly-snapshot');
    const result = await captureWeeklySnapshot(target);
    // 서버 액션 안에서 쓰는 read-your-own-writes 무효화. 적재 직후 화면이 옛 캐시를 보지 않게 한다.
    updateTag('report-data');
    return {
      ok: true,
      message:
        `${result.weekStart} ~ ${result.weekEnd} 적재 완료 · ${result.rowCount.toLocaleString('ko-KR')}행` +
        (result.provisional ? ' (진행 중인 주차라 잠정치입니다)' : '') +
        (result.replacedMidWeekStock
          ? ' · 주중에 찍어둔 잠정 재고를 마감 재고로 교체했습니다'
          : result.stockWritten
            ? ''
            : ' · 마감된 주차라 재고는 유지하고 출고·생산만 갱신했습니다'),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '적재에 실패했습니다.' };
  }
}
