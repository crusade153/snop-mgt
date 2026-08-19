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
import { buildWeeklySnapshotRows } from '@/lib/weekly/snapshot-builder';
import { completedWeekOf, isWeekEnd, seoulToday, weekRangeOf } from '@/lib/weekly/week';

export interface CaptureResult {
  weekStart: string;
  weekEnd: string;
  rowCount: number;
  /** 재고 열을 새로 쓴 적재인지. 마감된 주차를 두 번째로 돌리면 false 다 */
  stockWritten: boolean;
  /** 아직 안 끝난 주차인지. true 면 잠정치이고 다시 돌릴 때마다 재고까지 갱신된다 */
  provisional: boolean;
  unpricedItemCount: number;
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

  const { data: existing, error: existingError } = await supabase
    .from('snop_weekly_inventory_snapshots')
    .select('material_code')
    .eq('week_end_date', week.weekEnd)
    .limit(1);
  if (existingError) throw new Error(`기존 주간 스냅샷 확인 실패: ${existingError.message}`);

  const alreadyCaptured = (existing || []).length > 0;
  const rows = await buildWeeklySnapshotRows(week);

  if (rows.length === 0) throw new Error('적재할 재고가 없습니다. BigQuery 조회 결과를 확인하세요.');

  if (alreadyCaptured && !provisional) {
    // 마감된 주차의 재고는 "그때의 재고"라 다시 찍으면 값이 달라진다. 흐름 열만 갱신한다.
    for (const row of rows) {
      const { error } = await supabase
        .from('snop_weekly_inventory_snapshots')
        .update({
          shipped_qty: row.shipped_qty,
          shipped_value: row.shipped_value,
          produced_qty: row.produced_qty,
          produced_value: row.produced_value,
          sales_amount: row.sales_amount,
          sales_mtd: row.sales_mtd,
        })
        .eq('week_end_date', row.week_end_date)
        .eq('material_code', row.material_code)
        .eq('storage_scope', row.storage_scope);
      if (error) throw new Error(`주간 스냅샷 흐름 갱신 실패: ${error.message}`);
    }
  } else {
    const chunkSize = 500;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const { error } = await supabase
        .from('snop_weekly_inventory_snapshots')
        .upsert(rows.slice(index, index + chunkSize), {
          onConflict: 'week_end_date,material_code,storage_scope',
        });
      if (error) throw new Error(`주간 스냅샷 저장 실패: ${error.message}`);
    }
  }

  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    rowCount: rows.length,
    stockWritten: !alreadyCaptured || provisional,
    provisional,
    unpricedItemCount: rows.filter((row) => row.price_source !== 'ENDING_INVENTORY').length,
  };
}
