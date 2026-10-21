/**
 * 주간 스냅샷 「50% 미만」 세부 구간(0~20 / 20~40 / 40~50%) **역산 추정** 채우기 — 1회성
 *
 *   node scripts/backfill-under50-estimate.mjs              # 미리보기(아무 것도 쓰지 않는다)
 *   node scripts/backfill-under50-estimate.mjs --write      # 2026-10-18 주차에 저장
 *
 * ⚠️ 재고는 소급 생성이 불가능하다(CLAUDE.md). 세부 구간 열은 2026-10 에 추가돼 그 전 주차는 「미분해」다.
 *    이 스크립트는 **바로 직전 한 주차(2026-10-18)만** 예외로 추정치를 채운다 — 다음 주차(10/25)부터
 *    「전주 比」 세부 증감이 나오게 하려는 것이다. 사용자 확인을 거친 결정이다.
 *
 * 방법
 *   1. 그 주차의 플랜트 배치재고를 역산한다: 현재 배치재고(MM_MCHB) − 주차 종료일 다음 날부터의 이동(MM_MB51, 부호 있는 ERFMG).
 *   2. 배치의 제조일·유통기한(HSDAT·VFDAT)으로 **적재일 기준** 잔여율을 다시 계산해 SKU 별 0~20 / 20~40 / 40~50% 수량 비율을 만든다.
 *   3. **저장된 50% 미만 금액·수량(bucket_under50)을 그 비율로 나눈다.** 부모 값은 바꾸지 않는다 —
 *      그래서 5구간 합계·재고금액·두 축 합계는 손대기 전과 원 단위까지 같다.
 *   4. 역산 비율이 없는 행(물류센터 FBH 는 이동 이력이 없다, 그 사이 배치 마스터가 사라진 SKU)은
 *      같은 카테고리의 비율 → 전체 비율 순으로 빌려 쓴다.
 *   모든 행에 `under50_split_basis = 'MB51_ESTIMATE'` 를 남겨 화면이 「역산 추정」을 붙이게 한다.
 *
 * 실측 정합(2026-10-21): 역산한 50% 미만 수량이 저장값과 5% 이내로 맞는 SKU 가 206/283,
 * 금액으로 10.51억 / 15.07억(70%). 4주 전(9/20)은 40% 로 떨어져 **더 오래된 주차는 채우지 않는다.**
 * 역산 총수량은 저장값보다 20% 남짓 많다 — 이동 이력에 재고유형(가용/품질대기) 구분이 없어 품질대기가 섞이기 때문이다.
 * 그래서 절대 수량은 쓰지 않고 SKU 안의 **비율만** 쓴다.
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(ROOT + '/').href;

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      const ROOT = ${JSON.stringify(ROOT_URL)};
      export async function resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) {
          const base = ROOT + specifier.slice(2);
          for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
            try { return await nextResolve(base + ext, context); } catch {}
          }
        }
        return nextResolve(specifier, context);
      }
    `),
  import.meta.url,
);

for (const line of readFileSync(`${ROOT}/.env.local`, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.env[match[1]] = value;
}

/** 대상 주차는 고정이다. 다른 주차를 채우고 싶어지면 위 「실측 정합」부터 다시 잴 것 */
const WEEK = '2026-10-18';
/** 저장된 스냅샷이 잔여율을 계산한 날 = 월요일 cron 적재일(2026-10-19 05:41 KST) */
const AS_OF = '2026-10-19';
const BASIS = 'MB51_ESTIMATE';
const WRITE = process.argv.includes('--write');

const bigquery = (await import('@/lib/bigquery')).default;
const { storageScopeOfLgort, isFbhMirrorLocation, categoryOfMaterial } =
  await import('@/lib/weekly/classification');

const DATASET = 'harimfood-361004.harim_sap_bi';
const after = WEEK.replace(/-/g, '');
const rate = (field) =>
  `DATE_DIFF(vf, DATE '${AS_OF}', DAY) / DATE_DIFF(vf, hs, DAY) * 100 ${field}`;
const dated = `vf >= '2000-01-01' AND DATE_DIFF(vf, hs, DAY) > 0`;

// 1·2. 플랜트 배치재고 역산 → SKU × 저장위치별 세부 구간 수량
const [rebuiltRows] = await bigquery.query({
  query: `
    WITH now_stock AS (
      SELECT MATNR, LGORT, CHARG,
             SUM(IFNULL(CLABS, 0) + IFNULL(CINSM, 0) + IFNULL(CSPEM, 0)) AS qty_now,
             ANY_VALUE(HSDAT) AS HSDAT, ANY_VALUE(VFDAT) AS VFDAT
      FROM \`${DATASET}.MM_MCHB\`
      WHERE MATNR BETWEEN '50000000' AND '69999999'
      GROUP BY 1, 2, 3
    ),
    moved AS (
      SELECT MATNR, LGORT, CHARG, SUM(IFNULL(ERFMG, 0)) AS moved
      FROM \`${DATASET}.MM_MB51\`
      WHERE BUDAT > '${after}' AND MATNR BETWEEN '50000000' AND '69999999' AND IFNULL(LGORT, '') <> ''
      GROUP BY 1, 2, 3
    ),
    past AS (
      SELECT COALESCE(n.MATNR, m.MATNR) AS MATNR, COALESCE(n.LGORT, m.LGORT) AS LGORT,
             IFNULL(n.qty_now, 0) - IFNULL(m.moved, 0) AS qty,
             SAFE.PARSE_DATE('%Y%m%d', n.VFDAT) AS vf, SAFE.PARSE_DATE('%Y%m%d', n.HSDAT) AS hs
      FROM now_stock AS n FULL OUTER JOIN moved AS m USING (MATNR, LGORT, CHARG)
    )
    SELECT MATNR, LGORT,
      SUM(IF(${dated} AND ${rate('< 20')}, qty, 0)) AS u20,
      SUM(IF(${dated} AND ${rate('>= 20')} AND ${rate('< 40')}, qty, 0)) AS r2040,
      SUM(IF(${dated} AND ${rate('>= 40')} AND ${rate('< 50')}, qty, 0)) AS r4050
    FROM past
    WHERE qty > 0.0001
    GROUP BY 1, 2
  `,
});

/** SKU → 플랜트 역산 세부 구간 수량 */
const skuRatio = new Map();
rebuiltRows.forEach((row) => {
  if (isFbhMirrorLocation(row.LGORT) || storageScopeOfLgort(row.LGORT) !== 'PLANT') return;
  const entry = skuRatio.get(row.MATNR) || { u20: 0, r2040: 0, r4050: 0 };
  entry.u20 += Number(row.u20) || 0;
  entry.r2040 += Number(row.r2040) || 0;
  entry.r4050 += Number(row.r4050) || 0;
  skuRatio.set(row.MATNR, entry);
});
const ratioOf = (entry) => {
  const total = entry ? entry.u20 + entry.r2040 + entry.r4050 : 0;
  return total > 0 ? [entry.u20 / total, entry.r2040 / total, entry.r4050 / total] : null;
};

// 저장된 그 주차 행. PostgREST 상한(1000행) 때문에 range 페이징으로 읽는다.
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const stored = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('snop_weekly_inventory_snapshots')
    .select('material_code, storage_scope, dispo, bucket_under50, bucket_qty_under50, bucket_under20, under50_split_basis')
    .eq('week_end_date', WEEK)
    .order('material_code')
    .order('storage_scope')
    .range(from, from + 999);
  if (error) throw new Error(`스냅샷 조회 실패: ${error.message}`);
  stored.push(...data);
  if (data.length < 1000) break;
}
if (stored.length === 0) throw new Error(`${WEEK} 주차 스냅샷이 없습니다.`);

const measured = stored.filter(
  (row) => row.bucket_under20 !== null && row.under50_split_basis !== BASIS,
);
if (measured.length > 0) {
  // 실측으로 이미 채워진 주차를 추정치로 덮으면 안 된다.
  throw new Error(`${WEEK} 주차에 실측 세부 구간이 ${measured.length}행 있습니다. 추정치로 덮지 않습니다.`);
}

// 4. 카테고리 비율 → 전체 비율 폴백. 저장 금액에 SKU 비율을 곱한 금액 가중으로 만든다.
const categoryAccum = new Map();
const overallAccum = [0, 0, 0];
stored.forEach((row) => {
  const ratio = row.storage_scope === 'PLANT' ? ratioOf(skuRatio.get(row.material_code)) : null;
  if (!ratio || !(row.bucket_under50 > 0)) return;
  const category = categoryOfMaterial(row.material_code, row.dispo);
  const accum = categoryAccum.get(category) || [0, 0, 0];
  ratio.forEach((share, index) => {
    accum[index] += row.bucket_under50 * share;
    overallAccum[index] += row.bucket_under50 * share;
  });
  categoryAccum.set(category, accum);
});
const normalize = (values) => {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => value / total) : null;
};
const overallRatio = normalize(overallAccum);
if (!overallRatio) throw new Error('역산 비율을 하나도 만들지 못했습니다.');

/** 금액은 원 단위, 수량은 소수 3자리. 마지막 칸을 나머지로 맞춰 합이 부모와 정확히 같게 한다 */
const splitExact = (total, ratio, digits) => {
  const factor = 10 ** digits;
  const first = Math.round(total * ratio[0] * factor) / factor;
  const second = Math.round(total * ratio[1] * factor) / factor;
  return [first, second, Math.round((total - first - second) * factor) / factor];
};

const source = { sku: 0, skuFromPlant: 0, category: 0, overall: 0, zero: 0 };
const updates = stored.map((row) => {
  const under50 = Number(row.bucket_under50) || 0;
  const under50Qty = Number(row.bucket_qty_under50) || 0;
  let ratio = null;
  if (under50 > 0 || under50Qty > 0) {
    // 물류·기타 창고 행도 같은 SKU 의 플랜트 비율이 있으면 그걸 먼저 빌린다(같은 제품의 배치 흐름).
    ratio = ratioOf(skuRatio.get(row.material_code));
    if (ratio) {
      if (row.storage_scope === 'PLANT') source.sku += under50;
      else source.skuFromPlant += under50;
    } else {
      ratio = normalize(categoryAccum.get(categoryOfMaterial(row.material_code, row.dispo)) || [0, 0, 0]);
      if (ratio) source.category += under50;
      else {
        ratio = overallRatio;
        source.overall += under50;
      }
    }
  } else {
    source.zero += 1;
  }
  const values = ratio ? splitExact(under50, ratio, 0) : [0, 0, 0];
  const quantities = ratio ? splitExact(under50Qty, ratio, 3) : [0, 0, 0];
  return {
    material_code: row.material_code,
    storage_scope: row.storage_scope,
    bucket_under20: values[0],
    bucket_20_40: values[1],
    bucket_40_50: values[2],
    bucket_qty_under20: quantities[0],
    bucket_qty_20_40: quantities[1],
    bucket_qty_40_50: quantities[2],
    under50_split_basis: BASIS,
    _under50: under50,
  };
});

// 불변식 — 세 칸 합 = 부모, 음수 없음
const broken = updates.filter(
  (row) =>
    row.bucket_under20 + row.bucket_20_40 + row.bucket_40_50 !== row._under50 ||
    row.bucket_under20 < 0 || row.bucket_20_40 < 0 || row.bucket_40_50 < 0,
);
if (broken.length) throw new Error(`불변식 위반 ${broken.length}행 (예: ${broken[0].material_code})`);

const eok = (value) => `${(value / 1e8).toFixed(2)}억`;
const sumOf = (key, scopes) =>
  updates.filter((row) => scopes.includes(row.storage_scope)).reduce((sum, row) => sum + row[key], 0);
const display = ['PLANT', 'LOGISTICS'];
console.log(`\n${WEEK} 주차 50% 미만 세부 구간 역산 추정 (잔여율 기준일 ${AS_OF})`);
console.log(`  대상 ${updates.length.toLocaleString('ko-KR')}행 · 화면 범위(플랜트+물류) 합계`);
console.log(
  `  0~20% ${eok(sumOf('bucket_under20', display))} · 20~40% ${eok(sumOf('bucket_20_40', display))} · ` +
    `40~50% ${eok(sumOf('bucket_40_50', display))} = 50% 미만 ${eok(sumOf('_under50', display))}`,
);
console.log(
  `  비율 출처(금액, 전 창고): SKU 플랜트 역산 ${eok(source.sku)} · 같은 SKU 비율 차용(물류·기타) ${eok(source.skuFromPlant)} · ` +
    `카테고리 비율 ${eok(source.category)} · 전체 비율 ${eok(source.overall)}`,
);

if (!WRITE) {
  console.log('\n  미리보기입니다. 저장하려면 --write 를 붙이세요.\n');
  process.exit(0);
}

// 행마다 PK 가 달라 한 방 UPDATE 로 못 접는다. 순차로 돌리면 느리므로 동시성 25 로 묶는다(lib/weekly-snapshot.ts 와 같은 규칙).
const concurrency = 25;
for (let index = 0; index < updates.length; index += concurrency) {
  const results = await Promise.all(
    updates.slice(index, index + concurrency).map((row) =>
      supabase
        .from('snop_weekly_inventory_snapshots')
        .update({
          bucket_under20: row.bucket_under20,
          bucket_20_40: row.bucket_20_40,
          bucket_40_50: row.bucket_40_50,
          bucket_qty_under20: row.bucket_qty_under20,
          bucket_qty_20_40: row.bucket_qty_20_40,
          bucket_qty_40_50: row.bucket_qty_40_50,
          under50_split_basis: row.under50_split_basis,
        })
        .eq('week_end_date', WEEK)
        .eq('material_code', row.material_code)
        .eq('storage_scope', row.storage_scope),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`저장 실패: ${failed.error.message}`);
}
console.log(`\n  ✅ ${updates.length.toLocaleString('ko-KR')}행 저장 완료 (under50_split_basis = ${BASIS})\n`);
