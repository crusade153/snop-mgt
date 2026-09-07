/**
 * 주간 재고 스냅샷 적재 — Supabase 쓰기
 *
 * 행 생성(BigQuery 읽기)은 `lib/weekly/snapshot-builder.ts` 에 있다.
 * 그쪽은 `next/headers` 를 안 물기 때문에 `scripts/verify-weekly.mjs` 로 실데이터 검증이 가능하다.
 *
 * ⚠️ 재고는 소급 생성이 불가능하다. 같은 주차를 다시 돌리면 "지금 재고"가 들어오므로
 * **재고 열은 최초 1회만 쓰고 갱신하지 않는다.** 출고·생산·매출만 다시 계산해 덮어쓴다(전표 이력이라 소급 가능).
 */

import { createAdminSupabaseClient } from '@/lib/admin-auth';
import { syncMaterialHierarchy } from '@/lib/material-hierarchy';
import { buildWeeklySnapshotRows } from '@/lib/weekly/snapshot-builder';
import {
  canReplaceMidWeekStock,
  completedWeekOf,
  isWeekEnd,
  seoulToday,
  weekRangeOf,
} from '@/lib/weekly/week';

export interface CaptureResult {
  weekStart: string;
  weekEnd: string;
  rowCount: number;
  /** 재고 열을 새로 쓴 적재인지. 마감된 주차를 두 번째로 돌리면 false 다 */
  stockWritten: boolean;
  /**
   * 주중에 미리 찍어둔 잠정 재고를 **마감 재고로 갈아끼운** 적재인지.
   * 이때만 「마감된 주차인데도 재고를 다시 썼다」가 정상이다.
   */
  replacedMidWeekStock: boolean;
  /** 아직 안 끝난 주차인지. true 면 잠정치이고 다시 돌릴 때마다 재고까지 갱신된다 */
  provisional: boolean;
  unpricedItemCount: number;
  /**
   * 함께 갱신한 제품계층 마스터 품목 수(채널별 탭의 분류 원천).
   * 실패해도 적재는 계속하므로 0 일 수 있다 — 그때는 서버 로그에 경고가 남는다.
   */
  hierarchySynced: number;
}

/**
 * 한 주차를 적재한다.
 *
 * 인자를 주지 않으면 "직전에 끝난 주"(= 어제 끝난 일요일 마감 주)를 적재한다.
 * 월요일 05:40 cron 이 이 경로로 돈다.
 *
 * **진행 중인 주차(`weekEnd` 가 오늘 이후)도 적재할 수 있다.** 이 경우는 잠정치다 —
 * 재고는 "지금 재고", 출고·생산은 "주중 누계"이므로 돌릴 때마다 재고까지 통째로 갱신한다.
 * 주가 끝나고 월요일 cron 이 돌면 그때 값이 확정본으로 덮인다.
 *
 * 반대로 **이미 마감된 주차는 재고를 다시 쓰지 않는다.** 재고는 소급 생성이 불가능해서
 * 다시 찍으면 "그때의 재고"가 아니라 "지금 재고"가 들어오기 때문이다.
 */
export async function captureWeeklySnapshot(weekEndDate?: string): Promise<CaptureResult> {
  const week =
    weekEndDate && isWeekEnd(weekEndDate)
      ? weekRangeOf(weekEndDate)
      : completedWeekOf(seoulToday());

  // 주차 종료일이 아직 안 지났으면 진행 중인 주다.
  const provisional = week.weekEnd >= seoulToday();

  const supabase = createAdminSupabaseClient();

  // 이미 적재돼 있는지 + **언제 찍힌 값인지**. 두 번째가 중요하다 (바로 아래 설명).
  const { data: existing, error: existingError } = await supabase
    .from('snop_weekly_inventory_snapshots')
    .select('created_at')
    .eq('week_end_date', week.weekEnd)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existingError) throw new Error(`기존 주간 스냅샷 확인 실패: ${existingError.message}`);

  const alreadyCaptured = (existing || []).length > 0;

  /**
   * 주중에 미리 찍어둔 잠정 재고를 **마감 직후 재고로 갈아끼울 수 있는지.**
   * 판정은 `canReplaceMidWeekStock` 순수 함수에 있다 — 조건과 이유는 거기 주석을 볼 것.
   */
  const staleMidWeekCapture =
    alreadyCaptured &&
    canReplaceMidWeekStock(
      week.weekEnd,
      existing?.[0]?.created_at ? String(existing[0].created_at) : null,
      seoulToday()
    );
  const rows = await buildWeeklySnapshotRows(week);

  if (rows.length === 0) throw new Error('적재할 재고가 없습니다. BigQuery 조회 결과를 확인하세요.');

  /**
   * 채널별 탭이 쓰는 제품계층 마스터를 같이 갱신한다.
   *
   * ⚠️ **실패해도 적재를 막지 않는다.** 채널 축은 부가 축이고, 여기서 던지면 재고 스냅샷
   * 자체가 안 쌓인다 — 재고는 소급 생성이 불가능해 그 주차를 영영 잃는다.
   */
  let hierarchySynced = 0;
  try {
    hierarchySynced = (await syncMaterialHierarchy()).written;
  } catch (error) {
    console.warn(
      '⚠️ 제품계층 마스터 동기화 실패(적재는 계속합니다):',
      error instanceof Error ? error.message : error
    );
  }

  if (alreadyCaptured && !provisional && !staleMidWeekCapture) {
    // 마감된 주차의 재고는 "그때의 재고"라 다시 찍으면 값이 달라진다. 흐름 열만 갱신한다.
    //
    // ⚠️ 예외는 **기준정보 열(dispo·plant·category·product_name)** 이다. 이건 측정값이 아니라
    // 마스터라 소급 갱신이 맞다 — 자재의 DISPO 가 바로잡히면 지난 주차도 같은 칸에 들어가야
    // 「전주 재고·전주 比」가 같은 모수 위에서 비교된다. 재고·수량 열은 그대로 둔다.
    //
    // ⚠️ **`unit` 은 일부러 뺐다.** 품명과 달리 단위는 옆 칸의 `stock_qty` 가 무엇으로 세어졌는지를
    // 말하는 값이다. 수량을 그대로 둔 채 단위만 갈아끼우면 그 수량이 거짓이 된다.
    //
    // ⚠️ 행마다 PK 가 달라 한 방 UPDATE 로 못 접는다. 그렇다고 **순차로 돌리면 안 된다** —
    // 2천 행 × 왕복 지연이 그대로 쌓여 수 분이 걸리고, 라우트의 maxDuration(300초)에 걸릴 수 있다.
    // 실측: 2,135행을 순차로 돌렸을 때 호출자가 응답 없이 몇 분을 기다렸다.
    // 그래서 제한된 동시성으로 묶어 보낸다. Supabase 커넥션 풀을 흔들지 않을 만큼만 연다.
    const concurrency = 25;
    for (let index = 0; index < rows.length; index += concurrency) {
      const results = await Promise.all(
        rows.slice(index, index + concurrency).map((row) =>
          supabase
            .from('snop_weekly_inventory_snapshots')
            .update({
              dispo: row.dispo,
              plant: row.plant,
              category: row.category,
              product_name: row.product_name,
              shipped_qty: row.shipped_qty,
              shipped_value: row.shipped_value,
              produced_qty: row.produced_qty,
              produced_value: row.produced_value,
              shipped_mtd_qty: row.shipped_mtd_qty,
              shipped_mtd_value: row.shipped_mtd_value,
              sales_amount: row.sales_amount,
              sales_mtd: row.sales_mtd,
            })
            .eq('week_end_date', row.week_end_date)
            .eq('material_code', row.material_code)
            .eq('storage_scope', row.storage_scope)
        )
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw new Error(`주간 스냅샷 흐름 갱신 실패: ${failed.error.message}`);
    }
  } else {
    const chunkSize = 500;
    // 소비기한 잔여 열은 나중에 추가됐다. supabase/weekly-summary-board.sql 의 5번 블록을
    // 아직 안 돌린 환경에서도 적재가 죽지 않도록, 컬럼이 없으면 빼고 다시 넣는다.
    let dropRemainColumns = false;

    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      const write = (withRemain: boolean) =>
        supabase
          .from('snop_weekly_inventory_snapshots')
          .upsert(
            withRemain
              ? chunk
              : chunk.map((row) => {
                  const rest = { ...row };
                  delete rest.min_remain_day;
                  delete rest.avg_remain_rate;
                  return rest;
                }),
            { onConflict: 'week_end_date,material_code,storage_scope' }
          );

      let { error } = await write(!dropRemainColumns);
      if (error && !dropRemainColumns && /min_remain_day|avg_remain_rate/.test(error.message)) {
        console.warn(
          '⚠️ 소비기한 잔여 열이 없어 빼고 적재합니다. supabase/weekly-summary-board.sql 의 alter table 을 실행하세요.'
        );
        dropRemainColumns = true;
        ({ error } = await write(false));
      }
      if (error) throw new Error(`주간 스냅샷 저장 실패: ${error.message}`);
    }
  }

  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    rowCount: rows.length,
    stockWritten: !alreadyCaptured || provisional || staleMidWeekCapture,
    /** 주중에 미리 찍어둔 잠정 재고를 마감 재고로 갈아끼운 적재인지 */
    replacedMidWeekStock: staleMidWeekCapture && !provisional,
    provisional,
    unpricedItemCount: rows.filter((row) => row.price_source !== 'ENDING_INVENTORY').length,
    hierarchySynced,
  };
}
