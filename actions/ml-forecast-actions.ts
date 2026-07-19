'use server';

import bigqueryClient from '@/lib/bigquery';
import { getNeonSql, isNeonConfigured } from '@/lib/neon';
import { unstable_cache } from 'next/cache';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  머신러닝 예측 vs 실제 매출 비교
 * ───────────────────────────────────────────────────────────────────────────
 *  - 예측값: Neon(Postgres) — Python ML 파이프라인이 write 한 테이블
 *  - 실제값: BigQuery 납품매출(SD_ZASSDDV0020), MATNR·월 기준 집계
 *  - 매칭 키: MATNR / 비교 단위: 월별
 *
 *  Neon 테이블 스키마는 자동 조회(introspect)로 감지합니다.
 *  자동 감지가 틀릴 경우 아래 MANUAL_CONFIG 로 강제 지정하세요.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// 자동 감지가 부정확할 때만 채워서 강제 지정 (빈 문자열이면 자동 감지)
const MANUAL_CONFIG = {
  schema: '',      // 예: 'public'
  table: '',       // 예: 'demand_forecast'
  matnrCol: '',    // 예: 'matnr'
  monthCol: '',    // 예: 'forecast_month' (또는 Prophet 'ds')
  predictCol: '',  // 예: 'forecast_qty'  (또는 Prophet 'yhat')
};

// ─── 컬럼 자동 감지용 휴리스틱 ──────────────────────────────────────────────
const MATNR_RE = /(matnr|material|sku|item[_-]?(no|code|id)|product[_-]?(code|id|no)|자재)/i;
const MONTH_RE = /(month|ym|yyyymm|period|date|일자|월|forecast[_-]?(month|date|dt)|^ds$)/i;
const PRED_RE = /(pred|forecast|yhat|value|qty|quantity|demand|amount|수량|예측)/i;
const NUMERIC_TYPES = /(int|numeric|decimal|double|real|float|money)/i;

type ColumnMeta = { name: string; type: string };
type TableMeta = { schema: string; name: string; columns: ColumnMeta[] };
type Mapping = { schema: string; table: string; matnrCol: string; monthCol: string; predictCol: string };

// SQL identifier 안전 처리 (introspection 결과에서만 오지만 이중 방어)
function qid(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

async function fetchSchema(): Promise<TableMeta[]> {
  const sql = getNeonSql();
  const rows = (await sql.query(
    `SELECT table_schema, table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name, ordinal_position`
  )) as any[];

  const byTable = new Map<string, TableMeta>();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!byTable.has(key)) {
      byTable.set(key, { schema: r.table_schema, name: r.table_name, columns: [] });
    }
    byTable.get(key)!.columns.push({ name: r.column_name, type: r.data_type });
  }
  return Array.from(byTable.values());
}

const fetchSchemaCached = unstable_cache(fetchSchema, ['ml-forecast-schema'], {
  revalidate: 600,
});

function detectMapping(tables: TableMeta[]): Mapping | null {
  let best: { score: number; mapping: Mapping } | null = null;

  for (const t of tables) {
    const matnrCol = t.columns.find((c) => MATNR_RE.test(c.name));
    const monthCol = t.columns.find((c) => MONTH_RE.test(c.name));
    // 예측 컬럼은 숫자 타입 우선
    const predCandidates = t.columns.filter((c) => PRED_RE.test(c.name) && c.name !== matnrCol?.name);
    const predictCol =
      predCandidates.find((c) => NUMERIC_TYPES.test(c.type)) || predCandidates[0];

    if (!matnrCol || !monthCol || !predictCol) continue;

    let score = 3;
    if (NUMERIC_TYPES.test(predictCol.type)) score += 1;
    // 'forecast'/'yhat' 처럼 예측 전용 이름이면 가점
    if (/(forecast|yhat|pred)/i.test(predictCol.name)) score += 1;

    if (!best || score > best.score) {
      best = {
        score,
        mapping: {
          schema: t.schema,
          table: t.name,
          matnrCol: matnrCol.name,
          monthCol: monthCol.name,
          predictCol: predictCol.name,
        },
      };
    }
  }
  return best?.mapping ?? null;
}

function resolveMapping(tables: TableMeta[]): Mapping | null {
  if (MANUAL_CONFIG.table && MANUAL_CONFIG.matnrCol && MANUAL_CONFIG.monthCol && MANUAL_CONFIG.predictCol) {
    return {
      schema: MANUAL_CONFIG.schema || 'public',
      table: MANUAL_CONFIG.table,
      matnrCol: MANUAL_CONFIG.matnrCol,
      monthCol: MANUAL_CONFIG.monthCol,
      predictCol: MANUAL_CONFIG.predictCol,
    };
  }
  return detectMapping(tables);
}

type ProductInfo = { name: string; unit: string; umrezBox: number; unitsPerEa: number };

/**
 * ML 예측값은 '식(serving)' 단위인데 실제 매출/기본단위는 EA(봉지)다.
 * 제품명의 "112g*4" 처럼 `*N` 패턴이 EA당 식 수(입수)이므로, 예측값을 N으로 나눠 EA로 환산한다.
 * 패턴이 없으면 1 (환산 없음).
 */
function parseUnitsPerEa(name: string): number {
  const m = (name || '').match(/[*x×]\s*(\d+)/i);
  const n = m ? parseInt(m[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ─── 월 문자열 정규화 → 'YYYY-MM' ──────────────────────────────────────────
function normalizeMonth(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}`; // YYYYMM
  const m = s.match(/^(\d{4})[-/.](\d{1,2})/); // YYYY-MM / YYYY-MM-DD / YYYY/MM
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{4})(\d{2})\d{2}$/); // YYYYMMDD
  if (m2) return `${m2[1]}-${m2[2]}`;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  연결 테스트 & 스키마 조회 (discovery)
// ═══════════════════════════════════════════════════════════════════════════
export async function testNeonConnection() {
  if (!isNeonConfigured()) {
    return {
      configured: false,
      connected: false,
      error: 'NEON_DATABASE_URL 이 .env.local 에 설정되지 않았습니다.',
      tables: [] as TableMeta[],
      mapping: null as Mapping | null,
    };
  }
  try {
    const tables = await fetchSchemaCached();
    const mapping = resolveMapping(tables);
    return { configured: true, connected: true, tables, mapping, error: null as string | null };
  } catch (error: any) {
    return {
      configured: true,
      connected: false,
      error: error?.message || 'Neon 연결 실패',
      tables: [] as TableMeta[],
      mapping: null as Mapping | null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  예측 데이터 로드 (Neon)
// ═══════════════════════════════════════════════════════════════════════════
async function fetchPredictions(mapping: Mapping) {
  const sql = getNeonSql();
  const rel = `${qid(mapping.schema)}.${qid(mapping.table)}`;
  const text = `
    SELECT ${qid(mapping.matnrCol)}::text        AS matnr,
           ${qid(mapping.monthCol)}::text         AS month_raw,
           ${qid(mapping.predictCol)}::double precision AS predicted
    FROM ${rel}
    WHERE ${qid(mapping.predictCol)} IS NOT NULL
      AND ${qid(mapping.matnrCol)} IS NOT NULL
  `;
  const rows = (await sql.query(text)) as any[];

  // matnr → (month 'YYYY-MM' → 합산 예측)
  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const matnr = String(r.matnr).trim();
    const month = normalizeMonth(r.month_raw);
    const val = Number(r.predicted);
    if (!matnr || !month || !Number.isFinite(val)) continue;
    if (!byProduct.has(matnr)) byProduct.set(matnr, new Map());
    const mm = byProduct.get(matnr)!;
    mm.set(month, (mm.get(month) || 0) + val);
  }
  return byProduct;
}

// ═══════════════════════════════════════════════════════════════════════════
//  실제 매출 로드 (BigQuery, 월별 · MATNR)
// ═══════════════════════════════════════════════════════════════════════════
async function fetchActuals(matnrs: string[], startDate: string, endDate: string) {
  if (matnrs.length === 0) {
    return {
      actualByProduct: new Map<string, Map<string, number>>(),
      infoByProduct: new Map<string, ProductInfo>(),
    };
  }
  const sDate = startDate.replaceAll('-', '');
  const eDate = endDate.replaceAll('-', '');

  const query = `
    SELECT
      S.MATNR,
      SUBSTR(S.VDATU, 1, 6) AS month_key,
      SUM(CASE WHEN S.VRKME = 'BOX' THEN S.KWMENG * IFNULL(M.UMREZ_BOX, 1) ELSE S.KWMENG END) AS total_qty,
      MAX(S.ARKTX) AS name,
      MAX(IFNULL(M.MEINS, 'EA')) AS unit,
      MAX(IFNULL(M.UMREZ_BOX, 1)) AS umrez_box
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS S
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON S.MATNR = M.MATNR
    WHERE S.MATNR IN UNNEST(@matnrs)
      AND S.VDATU >= @sDate
      AND S.VDATU < @eDate
    GROUP BY S.MATNR, month_key
  `;
  const [rows] = await bigqueryClient.query({ query, params: { matnrs, sDate, eDate } });

  const actualByProduct = new Map<string, Map<string, number>>();
  const infoByProduct = new Map<string, ProductInfo>();
  for (const r of rows as any[]) {
    const matnr = String(r.MATNR).trim();
    const month = `${r.month_key.substring(0, 4)}-${r.month_key.substring(4, 6)}`;
    if (!actualByProduct.has(matnr)) actualByProduct.set(matnr, new Map());
    actualByProduct.get(matnr)!.set(month, Number(r.total_qty));
    if (!infoByProduct.has(matnr)) {
      const name = r.name || matnr;
      infoByProduct.set(matnr, {
        name,
        unit: r.unit || 'EA',
        umrezBox: Number(r.umrez_box) || 1,
        unitsPerEa: parseUnitsPerEa(name),
      });
    }
  }
  return { actualByProduct, infoByProduct };
}

// ─── 월 범위 유틸 ──────────────────────────────────────────────────────────
function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthCoverage(ym: string, startDate: string, endDate: string) {
  const [year, month] = ym.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEndExclusive = new Date(Date.UTC(year, month, 1));
  const rangeStart = parseDate(startDate);
  const rangeEndExclusive = parseDate(endDate);
  const coveredStart = Math.max(monthStart.getTime(), rangeStart.getTime());
  const coveredEnd = Math.min(monthEndExclusive.getTime(), rangeEndExclusive.getTime());
  const elapsedDays = Math.max(0, Math.round((coveredEnd - coveredStart) / 86_400_000));
  const totalDays = daysInMonth(ym);
  return { elapsedDays, totalDays, fraction: Math.min(1, elapsedDays / totalDays) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  비교 데이터 빌드
// ═══════════════════════════════════════════════════════════════════════════
async function buildComparison(mapping: Mapping, startDate: string, endDate: string) {
  const predByProduct = await fetchPredictions(mapping);
  const matnrs = Array.from(predByProduct.keys());
  if (matnrs.length === 0) return { success: true, data: [], mapping };

  const startMonth = startDate.slice(0, 7);
  const endExclusiveDate = parseDate(endDate);
  endExclusiveDate.setUTCDate(endExclusiveDate.getUTCDate() - 1);
  const comparisonMonth = formatMonth(endExclusiveDate);
  const comparisonMonths = monthRange(startMonth, comparisonMonth);
  const { actualByProduct, infoByProduct } = await fetchActuals(matnrs, startDate, endDate);

  const results = matnrs.map((matnr) => {
    const predMap = predByProduct.get(matnr)!;
    const actualMap = actualByProduct.get(matnr) || new Map<string, number>();
    const info = infoByProduct.get(matnr) || { name: matnr, unit: 'EA', umrezBox: 1, unitsPerEa: 1 };
    // ML 예측은 '식' 단위 → EA(기본단위)로 환산 (입수 N으로 나눔)
    const upe = info.unitsPerEa || 1;

    // 상단 필터와 겹치는 월만 검증합니다. 종료일은 완료되지 않은 당일이므로 비교에서 제외합니다.
    const months = comparisonMonths;

    // 월 총 예측(EA 환산, 한 달 전체 예상 수량)
    const predictedFull = months.map((m) => (predMap.has(m) ? Math.round(predMap.get(m)! / upe) : null));
    // 비교용 예측: 필터에 포함된 완료 일수만큼 월 예측을 안분합니다.
    const predicted = months.map((m, i) => {
      const pf = predictedFull[i];
      if (pf === null) return null;
      return Math.round(pf * monthCoverage(m, startDate, endDate).fraction);
    });
    const actual = months.map((m) => (actualMap.has(m) ? Math.round(actualMap.get(m)!) : null));

    // 정확도 지표: 실제와 (안분)예측이 모두 있고 실제>0 인 월
    let sumApe = 0;
    let sumBias = 0;
    let n = 0;
    months.forEach((m, i) => {
      const a = actual[i];
      const p = predicted[i];
      if (a !== null && a > 0 && p !== null) {
        sumApe += Math.abs(a - p) / a;
        sumBias += (p - a) / a;
        n += 1;
      }
    });
    const mape = n > 0 ? (sumApe / n) * 100 : null;
    const bias = n > 0 ? (sumBias / n) * 100 : null;
    const accuracy = mape !== null ? Math.max(0, Math.round((100 - mape) * 10) / 10) : null;

    // 진행 중인 달 정보 (월 총 예상 vs 현재까지 실적 vs 안분 예측)
    const asOfIdx = months.indexOf(comparisonMonth);
    const coverage = monthCoverage(comparisonMonth, startDate, endDate);
    const inProgress =
      asOfIdx >= 0 && predictedFull[asOfIdx] !== null
        ? {
            month: comparisonMonth,
            elapsedDays: coverage.elapsedDays,
            daysInMonth: coverage.totalDays,
            fraction: coverage.fraction,
            actualToDate: actual[asOfIdx],
            proratedPredicted: predicted[asOfIdx],
            fullPredicted: predictedFull[asOfIdx],
          }
        : null;

    // 다음 달 예측(월 총) — 데이터 기준월 이후 첫 예측 월
    const nextForecastMonth = Array.from(predMap.keys()).sort().find((m) => m > comparisonMonth) ?? null;
    const nextForecast = nextForecastMonth ? Math.round(predMap.get(nextForecastMonth)! / upe) : null;
    const periodPredicted = predicted.reduce<number>((sum, value) => sum + (value ?? 0), 0);

    return {
      info: { id: matnr, name: info.name, unit: info.unit, umrezBox: info.umrezBox, unitsPerEa: upe },
      months,
      actual,
      predicted,
      predictedFull,
      inProgress,
      metrics: { mape, bias, accuracy, nComparable: n, nextForecast, nextForecastMonth, periodPredicted },
    };
  });

  // 검증 대상 목록은 선택 기간의 비교 예측치가 큰 품목부터 보여줍니다.
  results.sort((a, b) => {
    const byPrediction = b.metrics.periodPredicted - a.metrics.periodPredicted;
    if (byPrediction !== 0) return byPrediction;
    return (b.metrics.accuracy ?? -1) - (a.metrics.accuracy ?? -1);
  });

  return { success: true, data: results, mapping, dataAsOf: endDate };
}

export async function getMlComparison(searchTerm = '', startDate?: string, endDate?: string) {
  const term = (searchTerm || '').trim().toLowerCase();
  try {
    if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate >= endDate) {
      return { success: false, data: [], error: '조회 시작일은 종료일보다 앞서야 합니다.', mapping: null as Mapping | null, dataAsOf: null as string | null };
    }
    if (!isNeonConfigured()) {
      return { success: false, data: [], error: 'NEON_DATABASE_URL 미설정', mapping: null as Mapping | null, dataAsOf: null as string | null };
    }
    const tables = await fetchSchemaCached();
    const mapping = resolveMapping(tables);
    if (!mapping) {
      return {
        success: false,
        data: [],
        error: 'ML 예측 테이블을 자동 감지하지 못했습니다. (MATNR·월·예측값 컬럼 필요)',
        mapping: null,
        dataAsOf: null as string | null,
      };
    }

    const built = await unstable_cache(
      async () => buildComparison(mapping, startDate, endDate),
      ['ml-comparison-v4-filter-range', mapping.schema, mapping.table, mapping.matnrCol, mapping.monthCol, mapping.predictCol, startDate, endDate],
      { revalidate: 600, tags: ['report-data'] }
    )();

    let data = built.data;
    if (term) {
      data = data.filter(
        (d) => d.info.id.toLowerCase().includes(term) || (d.info.name || '').toLowerCase().includes(term)
      );
    }
    return { success: true, data, error: null, mapping, dataAsOf: built.dataAsOf ?? null };
  } catch (error: any) {
    console.error('ML Comparison Error:', error);
    return { success: false, data: [], error: error?.message || '비교 데이터 로드 실패', mapping: null, dataAsOf: null };
  }
}
