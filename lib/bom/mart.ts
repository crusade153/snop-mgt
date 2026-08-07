/**
 * BOM 마트 적재·조회
 *
 * 적재는 BigQuery 전개 결과를 Supabase 로 옮기는 것뿐이다.
 * BigQuery 는 이 앱에서 읽기 전용이고, 자재코드 역조회는 인덱스 있는 OLTP 조회가
 * 맞기 때문에(BQ 는 쿼리당 스캔 과금 + 수초 지연) 마트를 Postgres 에 둔다.
 *
 * 쓰기 경로는 lib/inventory-daily-snapshot.ts 의 검증된 패턴을 따르되
 * 갱신 순서만 다르다 — 아래 rebuildBomMart 주석 참고.
 */

import bigqueryClient from '@/lib/bigquery';
import { createAdminSupabaseClient } from '@/lib/admin-auth';
import { buildBomExplosionQuery, MAX_BOM_LEVEL, type BomScope } from '@/lib/bom/explosion-sql';
import { num, text, toBomLeafRow, toLeafRecord } from '@/lib/bom/leaf';
import type { BomBuildRun, BomLeafRow } from '@/types/material';

const TABLE = 'snop_bom_leaf';
const RUNS_TABLE = 'snop_bom_build_runs';
// 원·부자재까지 포함하면 5만행이 넘는다. 1,000행씩 나누면 왕복만 52번이라
// 서버 액션 시간 제한에 걸린다. 요청당 약 1MB 수준으로 키워 왕복을 줄인다.
const CHUNK = 2000;
// 조회는 Supabase 가 응답당 1,000행으로 제한한다(서버 설정이라 클라이언트에서 못 늘린다).
const PAGE = 1000;

type RawLeaf = Record<string, unknown>;

export type RebuildResult = {
  buildId: string;
  rowCount: number;
  rootCount: number;
  materialCount: number;
  bqMs: number;
  depthCapHits: number;
  uomMismatchCount: number;
  suspectLotBasisCount: number;
};

/**
 * 마트를 전량 재생성한다.
 *
 * ⚠️ 갱신 순서가 중요하다. inventory-daily-snapshot.ts 는 DELETE 를 먼저 하지만
 *    여기서는 절대 그러면 안 된다 — 조회 측이 빈 구간을 보게 된다.
 *    새 build_id 로 upsert 를 전부 끝낸 뒤에 구 build_id 를 지운다.
 *    실패하면 구 데이터가 그대로 살아 있다.
 */
export async function rebuildBomMart(options: {
  scope?: BomScope;
  plants?: string[];
  triggeredBy?: string | null;
  triggeredByName?: string | null;
} = {}): Promise<RebuildResult> {
  const scope = options.scope ?? 'RAW_AND_PACKAGING';
  const plants = options.plants ?? [];
  const supabase = createAdminSupabaseClient();
  const buildId = crypto.randomUUID();

  await supabase.from(RUNS_TABLE).insert({
    build_id: buildId,
    status: 'RUNNING',
    scope,
    triggered_by: options.triggeredBy ?? null,
    triggered_by_name: options.triggeredByName ?? null,
  });

  try {
    const startedAt = Date.now();
    const [rows] = await bigqueryClient.query({
      query: buildBomExplosionQuery(scope),
      params: { maxLevel: MAX_BOM_LEVEL, plants },
      types: { maxLevel: 'INT64', plants: ['STRING'] },
    });
    const bqMs = Date.now() - startedAt;

    if (!rows.length) {
      throw new Error('BOM 전개 결과가 0행입니다. 구 데이터를 유지하고 중단합니다.');
    }

    const records = (rows as RawLeaf[]).map((row) => toLeafRecord(row, buildId));

    for (let index = 0; index < records.length; index += CHUNK) {
      const { error } = await supabase
        .from(TABLE)
        .upsert(records.slice(index, index + CHUNK), {
          onConflict: 'root_matnr,material_code,werks',
        });
      if (error) throw new Error(`BOM 마트 적재 실패: ${error.message}`);
    }

    // 적재가 전부 끝난 뒤에만 구 빌드를 정리한다.
    const { error: cleanupError } = await supabase.from(TABLE).delete().neq('build_id', buildId);
    if (cleanupError) throw new Error(`구 BOM 마트 정리 실패: ${cleanupError.message}`);

    const result: RebuildResult = {
      buildId,
      rowCount: records.length,
      rootCount: new Set(records.map((r) => r.root_matnr)).size,
      materialCount: new Set(records.map((r) => r.material_code)).size,
      bqMs,
      depthCapHits: records.filter((r) => r.hit_depth_cap).length,
      uomMismatchCount: records.filter((r) => r.uom_mismatch).length,
      suspectLotBasisCount: records.filter((r) => r.suspect_lot_basis).length,
    };

    await supabase
      .from(RUNS_TABLE)
      .update({
        status: 'SUCCESS',
        finished_at: new Date().toISOString(),
        row_count: result.rowCount,
        root_count: result.rootCount,
        material_count: result.materialCount,
        bq_ms: result.bqMs,
        depth_cap_hits: result.depthCapHits,
        uom_mismatch_count: result.uomMismatchCount,
        suspect_lot_basis_count: result.suspectLotBasisCount,
      })
      .eq('build_id', buildId);

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from(RUNS_TABLE)
      .update({ status: 'FAILED', finished_at: new Date().toISOString(), error_message: message })
      .eq('build_id', buildId);
    throw error;
  }
}

/** 마지막 빌드 이력. 화면 상단의 "언제 만든 데이터인가" 표시에 쓴다. */
export async function getLatestBomBuild(): Promise<BomBuildRun | null> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from(RUNS_TABLE)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`BOM 빌드 이력 조회 실패: ${error.message}`);
  if (!data) return null;

  return {
    buildId: text(data.build_id),
    startedAt: text(data.started_at),
    finishedAt: data.finished_at ? text(data.finished_at) : null,
    status: text(data.status, 'RUNNING') as BomBuildRun['status'],
    scope: text(data.scope),
    triggeredByName: data.triggered_by_name ? text(data.triggered_by_name) : null,
    rowCount: data.row_count === null ? null : num(data.row_count),
    rootCount: data.root_count === null ? null : num(data.root_count),
    materialCount: data.material_count === null ? null : num(data.material_count),
    bqMs: data.bq_ms === null ? null : num(data.bq_ms),
    depthCapHits: data.depth_cap_hits === null ? null : num(data.depth_cap_hits),
    uomMismatchCount: data.uom_mismatch_count === null ? null : num(data.uom_mismatch_count),
    suspectLotBasisCount:
      data.suspect_lot_basis_count === null ? null : num(data.suspect_lot_basis_count),
    errorMessage: data.error_message ? text(data.error_message) : null,
  };
}

export async function getBomBuildHistory(limit = 10): Promise<BomBuildRun[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from(RUNS_TABLE)
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`BOM 빌드 이력 조회 실패: ${error.message}`);
  return (data ?? []).map((row) => ({
    buildId: text(row.build_id),
    startedAt: text(row.started_at),
    finishedAt: row.finished_at ? text(row.finished_at) : null,
    status: text(row.status, 'RUNNING') as BomBuildRun['status'],
    scope: text(row.scope),
    triggeredByName: row.triggered_by_name ? text(row.triggered_by_name) : null,
    rowCount: row.row_count === null ? null : num(row.row_count),
    rootCount: row.root_count === null ? null : num(row.root_count),
    materialCount: row.material_count === null ? null : num(row.material_count),
    bqMs: row.bq_ms === null ? null : num(row.bq_ms),
    depthCapHits: row.depth_cap_hits === null ? null : num(row.depth_cap_hits),
    uomMismatchCount: row.uom_mismatch_count === null ? null : num(row.uom_mismatch_count),
    suspectLotBasisCount:
      row.suspect_lot_basis_count === null ? null : num(row.suspect_lot_basis_count),
    errorMessage: row.error_message ? text(row.error_message) : null,
  }));
}

/** range() 만 붙이면 되는 최소 형태. Supabase 쿼리 빌더가 이 모양을 만족한다. */
type RangeableQuery = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Supabase 는 한 번에 1000행까지만 준다. 필터가 넓을 수 있으니 항상 페이징한다.
 * ⚠️ 쿼리 빌더는 일회용(thenable)이라 페이지마다 새로 만들어야 한다.
 *    그래서 완성된 쿼리가 아니라 "쿼리를 만드는 함수"를 받는다.
 */
async function fetchPaged(build: () => RangeableQuery): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`BOM 마트 조회 실패: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function leafTable() {
  return createAdminSupabaseClient().from(TABLE).select('*');
}

/**
 * 역전개 — 이 자재를 쓰는 완제품 목록.
 * 마케팅이 실제로 묻는 질문이고, (material_code, werks) 인덱스로 즉답된다.
 */
export async function getReverseBom(materialCode: string, werks?: string): Promise<BomLeafRow[]> {
  const rows = await fetchPaged(() => {
    const query = leafTable().eq('material_code', materialCode);
    return (werks ? query.eq('werks', werks) : query).order('qty_per_fg', { ascending: false });
  });
  return rows.map(toBomLeafRow);
}

/** 정전개 — 이 완제품이 쓰는 자재 목록. 제품 상세 화면에서 반대 방향으로 잇는다. */
export async function getForwardBom(rootMatnr: string, werks?: string): Promise<BomLeafRow[]> {
  const rows = await fetchPaged(() => {
    const query = leafTable().eq('root_matnr', rootMatnr);
    return (werks ? query.eq('werks', werks) : query).order('qty_per_fg', { ascending: false });
  });
  return rows.map(toBomLeafRow);
}

/** in() 필터가 길면 URL 길이 제한에 걸린다. 코드 목록을 잘라서 돌린다. */
async function fetchByCodes(column: string, codes: string[]): Promise<BomLeafRow[]> {
  if (!codes.length) return [];
  const unique = [...new Set(codes)];
  const BATCH = 200;
  const out: BomLeafRow[] = [];
  for (let index = 0; index < unique.length; index += BATCH) {
    const slice = unique.slice(index, index + BATCH);
    const rows = await fetchPaged(() => leafTable().in(column, slice).order('root_matnr'));
    out.push(...rows.map(toBomLeafRow));
  }
  return out;
}

/** 자재 여러 건의 전체 사용처. 공용/전용 판정에 쓰므로 담당자 스코프로 좁히면 안 된다. */
export function getBomLeafByMaterials(materialCodes: string[]): Promise<BomLeafRow[]> {
  return fetchByCodes('material_code', materialCodes);
}

/** 완제품 여러 건이 쓰는 자재. 담당자 스코프의 1차 필터로 쓴다. */
export function getBomLeafByRoots(rootMatnrs: string[]): Promise<BomLeafRow[]> {
  return fetchByCodes('root_matnr', rootMatnrs);
}

/** 마트 전량. 전사 집계에 쓴다. 실측 8,213행이라 감당 가능하다. */
export async function getAllBomLeaf(): Promise<BomLeafRow[]> {
  const rows = await fetchPaged(() => leafTable().order('material_code'));
  return rows.map(toBomLeafRow);
}
