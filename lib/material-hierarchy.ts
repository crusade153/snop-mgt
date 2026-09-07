/**
 * 자재 → 제품계층 마스터 동기화 (BigQuery 읽기 → Supabase 쓰기)
 *
 * 주간 장표의 「채널별」 탭은 제품계층 2레벨(`PRDHA_2_T`)로 재고를 찢는데,
 * 그 장표는 **BigQuery 를 읽지 않는다**(주 1회 적재된 Supabase 스냅샷만 읽는다).
 * 그래서 마스터를 `snop_material_hierarchy` 에 한 벌 복사해 두고 조회 때 조인한다.
 *
 * ⚠️ **스냅샷 행에 LV2 를 박지 않은 것은 의도다.** 제품계층은 측정값이 아니라 기준정보라
 * 소급 적용이 맞다 — 이 표를 한 번 갱신하면 **이미 적재된 과거 주차까지** 같은 채널로 접힌다.
 * 스냅샷 열로 두면 주차마다 다시 적재해야 하는데 재고는 소급 생성이 불가능하다.
 *
 * ⚠️ 삭제는 하지 않는다. 마스터에서 빠진 자재라도 과거 주차 스냅샷에는 남아 있어서,
 * 지우면 그 주차의 채널이 통째로 「미분류」로 바뀐다.
 */

import bigqueryClient from '@/lib/bigquery';
import { createAdminSupabaseClient } from '@/lib/admin-auth';
import { buildMaterialHierarchyQuery } from '@/lib/weekly/queries';

export interface MaterialHierarchySyncResult {
  /** BigQuery 에서 읽은 자재 수 */
  fetched: number;
  /** Supabase 에 upsert 한 행 수 */
  written: number;
}

interface HierarchyQueryRow {
  MATNR: string;
  PRDHA_1_T: string | null;
  PRDHA_2_T: string | null;
  PRDHA_3_T: string | null;
}

/**
 * 마스터를 통째로 다시 복사한다. 완제품·상품 대역만이라 6천 행 남짓이고 주 1회만 돈다.
 *
 * 테이블이 아직 없는 환경(마이그레이션 미실행)에서는 **던지지 않고 0 을 돌려준다** —
 * 주간 적재가 이것 때문에 통째로 실패하면 안 되기 때문이다. 화면 쪽에서 안내 문구가 뜬다.
 */
export async function syncMaterialHierarchy(): Promise<MaterialHierarchySyncResult> {
  const [rows] = await bigqueryClient.query({ query: buildMaterialHierarchyQuery() });
  const source = (rows || []) as HierarchyQueryRow[];

  const payload = source.map((row) => ({
    material_code: String(row.MATNR),
    prdha_1: row.PRDHA_1_T ? String(row.PRDHA_1_T) : null,
    prdha_2: row.PRDHA_2_T ? String(row.PRDHA_2_T) : null,
    prdha_3: row.PRDHA_3_T ? String(row.PRDHA_3_T) : null,
    updated_at: new Date().toISOString(),
  }));

  const supabase = createAdminSupabaseClient();
  const chunkSize = 500;
  let written = 0;

  for (let index = 0; index < payload.length; index += chunkSize) {
    const { error } = await supabase
      .from('snop_material_hierarchy')
      .upsert(payload.slice(index, index + chunkSize), { onConflict: 'material_code' });
    if (error) {
      if (/snop_material_hierarchy/.test(error.message) && /find the table|does not exist/i.test(error.message)) {
        console.warn(
          '⚠️ snop_material_hierarchy 테이블이 없어 제품계층 동기화를 건너뜁니다. supabase/weekly-summary-board.sql 의 7번 블록을 실행하세요.'
        );
        return { fetched: payload.length, written: 0 };
      }
      throw new Error(`제품계층 마스터 저장 실패: ${error.message}`);
    }
    written += Math.min(chunkSize, payload.length - index);
  }

  return { fetched: payload.length, written };
}
