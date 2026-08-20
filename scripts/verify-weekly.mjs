/**
 * 주간 요약장표 읽기 전용 검증
 *
 * 이 저장소에는 테스트 프레임워크가 없다. 대신 앱이 실제로 쓰는 모듈을 그대로 불러
 * 실데이터로 돌려보고 불변식을 확인한다. **아무 것도 쓰지 않는다**(Supabase 적재 안 함, SELECT 전용).
 *
 *   node scripts/verify-weekly.mjs
 *
 * 확인하는 것
 *   1. 주차 계산이 월~일로 맞는가 (손계산 대조)
 *   2. 적재 행이 만들어지는가, 규모가 상식적인가
 *   3. 구간별 재고금액의 합 = 재고금액 (구간 표와 상단 표가 구조적으로 일치하는지의 근거)
 *   4. 출고·생산·매출이 SKU 당 한 창고그룹에만 실려 중복 합산되지 않는가
 *   5. 물류 재고와 이중계상되는 저장위치(3000)가 빠졌는가
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(ROOT + '/').href;

// Next 런타임 밖에서 쓰기 위한 셰임.
//  - '@/...' 별칭: tsconfig paths 가 안 먹으므로 프로젝트 루트로 직접 푼다.
//  - 'next/cache': unstable_cache 를 통과 함수로 바꾼다. 캐시가 없어도 계산 결과는 같고,
//    오히려 캐시를 타지 않아 매번 실제 데이터를 읽으므로 검증에는 이쪽이 맞다.
const NEXT_CACHE_SHIM =
  'data:text/javascript,' +
  encodeURIComponent(`
    export const unstable_cache = (fn) => fn;
    export const revalidateTag = () => {};
    export const revalidatePath = () => {};
  `);

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      const ROOT = ${JSON.stringify(ROOT_URL)};
      const NEXT_CACHE_SHIM = ${JSON.stringify(NEXT_CACHE_SHIM)};
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === 'next/cache') {
          return { url: NEXT_CACHE_SHIM, format: 'module', shortCircuit: true };
        }
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

// dotenv 가 없으므로 .env.local 을 직접 읽는다.
for (const line of readFileSync(`${ROOT}/.env.local`, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.env[match[1]] = value;
}

const { weekRangeOf, completedWeekOf, previousWeekEnd, isWeekEnd, monthToDateRange } =
  await import('@/lib/weekly/week');
const { categoryOfDispo, plantOfDispo, cmOfCategory, storageScopeOfLgort, isFbhMirrorLocation } =
  await import('@/lib/weekly/classification');
const { buildWeeklyBoard, resolveCm, sumBuckets, WEEKLY_BUCKET_KEYS } = await import('@/lib/weekly/board');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

console.log('\n[1] 주차 계산 (월~일)');
{
  // 2026-08-19 는 수요일. 그 주는 8/17(월) ~ 8/23(일)이다.
  const week = weekRangeOf('2026-08-19');
  check('수요일 → 그 주 월~일', week.weekStart === '2026-08-17' && week.weekEnd === '2026-08-23',
    `${week.weekStart} ~ ${week.weekEnd}`);

  // 일요일은 그 주의 마지막 날이어야 한다(다음 주로 넘어가면 안 된다).
  const sunday = weekRangeOf('2026-08-23');
  check('일요일은 그 주 마지막 날', sunday.weekEnd === '2026-08-23', sunday.weekEnd);

  // 월요일 새벽 cron 이 도는 시점에는 "어제 끝난 주"를 적재해야 한다.
  const completed = completedWeekOf('2026-08-24');
  check('월요일 적재 대상 = 직전 주', completed.weekStart === '2026-08-17' && completed.weekEnd === '2026-08-23',
    `${completed.weekStart} ~ ${completed.weekEnd}`);

  check('전주 종료일', previousWeekEnd('2026-08-23') === '2026-08-16');
  check('주차 키 가드', isWeekEnd('2026-08-23') && !isWeekEnd('2026-08-19'));

  const mtd = monthToDateRange('2026-08-23');
  check('월매출 누계 구간', mtd.from === '2026-08-01' && mtd.to === '2026-08-23', `${mtd.from} ~ ${mtd.to}`);
}

console.log('\n[2] 분류 규칙 (확정된 DISPO 매핑)');
{
  check('M01 → 냉동/K1', categoryOfDispo('M01') === '냉동' && plantOfDispo('M01') === 'K1');
  check('M07 → HMI/K1', categoryOfDispo('M07') === 'HMI' && plantOfDispo('M07') === 'K1');
  check('M13(전처리) → 라면/K3', categoryOfDispo('M13') === '라면' && plantOfDispo('M13') === 'K3');
  check('M19(분말스프) → 라면/K3', categoryOfDispo('M19') === '라면' && plantOfDispo('M19') === 'K3');
  check('M31(FD) → 즉석밥/K2', categoryOfDispo('M31') === '즉석밥' && plantOfDispo('M31') === 'K2');
  check('A 계열은 뒤 두 자리로 M 과 같은 분류',
    categoryOfDispo('A08') === 'HMI' && categoryOfDispo('A03') === '냉동' &&
    categoryOfDispo('A09') === 'HMI' && plantOfDispo('A04') === 'K1');
  check('H01(상품) → 상품 카테고리', categoryOfDispo('H01') === '상품' && plantOfDispo('H01') === '기타');
  check('상품 CM 은 CM1~3 과 분리', cmOfCategory('상품') === '상품' &&
    resolveCm('50000001', '상품', new Map([['50000001', 'CM1']])) === '상품');
  check('M18·마스터없음은 아직 기타',
    categoryOfDispo('M18') === '기타' && categoryOfDispo('') === '기타' && categoryOfDispo(null) === '기타');
  check('저장위치 그룹', storageScopeOfLgort('2210') === 'PLANT' && storageScopeOfLgort('9100') === 'OTHER');
  check('3000(물류창고)은 FBH 미러라 제외', isFbhMirrorLocation('3000') && !isFbhMirrorLocation('2210'));
}

console.log('\n[3] 실데이터 적재 행 생성 (BigQuery 읽기 전용)');
const { buildWeeklySnapshotRows } = await import('@/lib/weekly/snapshot-builder');
const week = completedWeekOf(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()),
);
console.log(`  대상 주차: ${week.weekStart} ~ ${week.weekEnd}`);

const rows = await buildWeeklySnapshotRows(week);
check('행이 만들어짐', rows.length > 0, `${rows.length.toLocaleString('ko-KR')} 행`);

const skuCount = new Set(rows.map((row) => row.material_code)).size;
check('SKU 수가 상식적', skuCount > 100 && skuCount < 5000, `${skuCount} SKU`);

console.log('\n[4] 불변식');
{
  // 구간별 금액의 합은 재고금액과 같아야 한다.
  // 이게 깨지면 구간 표와 상단 표의 합계가 갈린다(원본 수기 엑셀이 정확히 그 상태였다).
  const mismatched = rows.filter((row) => {
    const bucketSum =
      row.bucket_under50 + row.bucket_50_70 + row.bucket_70_75 + row.bucket_75_85 + row.bucket_85_over;
    return Math.abs(bucketSum - row.stock_value) > 5; // 행마다 반올림 오차 몇 원은 허용
  });
  check('구간 합 = 재고금액', mismatched.length === 0,
    mismatched.length ? `${mismatched.length}행 불일치 (예: ${mismatched[0].material_code})` : '전 행 일치');

  // 출고·생산·매출은 SKU 당 한 창고그룹에만 실려야 한다(창고그룹으로 나눌 수 없는 값이라서).
  const flowScopes = new Map();
  rows.forEach((row) => {
    if (row.shipped_qty === 0 && row.produced_qty === 0 && row.sales_mtd === 0) return;
    flowScopes.set(row.material_code, (flowScopes.get(row.material_code) || 0) + 1);
  });
  const duplicated = [...flowScopes.entries()].filter(([, count]) => count > 1);
  check('흐름은 SKU 당 1개 그룹', duplicated.length === 0,
    duplicated.length ? `${duplicated.length}개 SKU 중복` : '중복 없음');

  check('음수 생산 없음', rows.every((row) => row.produced_qty >= 0));
  check('음수 재고 없음', rows.every((row) => row.stock_qty >= 0));

  const scopes = new Set(rows.map((row) => row.storage_scope));
  check('창고 그룹이 3종 이내', [...scopes].every((scope) => ['PLANT', 'LOGISTICS', 'OTHER'].includes(scope)),
    [...scopes].join(', '));
}

console.log('\n[5] 집계 (화면이 보는 형태)');
{
  const board = buildWeeklyBoard({ current: rows, previous: [], cmMapping: new Map(), scopes: [] });
  const rowTotal = board.rows.reduce((sum, row) => sum + row.stockValue, 0);
  check('행 합 = 합계행', Math.abs(rowTotal - board.totals.stockValue) < 5,
    `${Math.round(board.totals.stockValue).toLocaleString('ko-KR')} 원`);

  const bucketTotal = sumBuckets(board.totals.buckets);
  check('구간 합계 = 재고 합계', Math.abs(bucketTotal - board.totals.stockValue) < 100,
    `구간 ${Math.round(bucketTotal).toLocaleString('ko-KR')} / 재고 ${Math.round(board.totals.stockValue).toLocaleString('ko-KR')}`);

  // 적재 당시 굳은 category 열이 아니라 지금의 dispo 판정으로 접혀야 한다(매핑을 넓히면 과거 주차도 따라온다).
  const staleRows = rows.filter((row) => row.category !== categoryOfDispo(row.dispo));
  const byDerivedCategory = new Map();
  rows.forEach((row) => {
    const category = categoryOfDispo(row.dispo);
    byDerivedCategory.set(category, (byDerivedCategory.get(category) || 0) + row.stock_value);
  });
  const foldedMismatch = board.rows.reduce((worst, row) => {
    const expected = byDerivedCategory.get(row.category) || 0;
    const actual = board.rows
      .filter((other) => other.category === row.category)
      .reduce((sum, other) => sum + other.stockValue, 0);
    return Math.max(worst, Math.abs(expected - actual));
  }, 0);
  check('집계는 저장 열이 아니라 dispo 로 다시 판정', foldedMismatch < 5,
    staleRows.length ? `적재 열과 다른 ${staleRows.length}행도 새 기준으로 접힘` : '적재 열과 동일');

  console.log('\n  [참고] CM × 공장 × 카테고리');
  board.rows.forEach((row) => {
    console.log(
      `    ${row.cm} ${row.plant} ${row.category.padEnd(4)} 재고 ${Math.round(row.stockValue).toLocaleString('ko-KR').padStart(15)}` +
      ` 출고 ${Math.round(row.shippedValue).toLocaleString('ko-KR').padStart(14)}` +
      ` 생산 ${Math.round(row.producedValue).toLocaleString('ko-KR').padStart(14)}`,
    );
  });

  if (board.unmappedDispo.length) {
    console.log('\n  [주의] 카테고리 미매핑 DISPO (기타 행으로 잡힘)');
    board.unmappedDispo.slice(0, 10).forEach((entry) => {
      console.log(
        `    ${String(entry.dispo).padEnd(12)} ${Math.round(entry.value).toLocaleString('ko-KR').padStart(15)} 원  ${entry.itemCount}품목`,
      );
    });
    const unmappedTotal = board.unmappedDispo.reduce((sum, entry) => sum + entry.value, 0);
    console.log(
      `    합계 ${Math.round(unmappedTotal).toLocaleString('ko-KR')} 원 ` +
      `(전체의 ${((unmappedTotal / board.totals.stockValue) * 100).toFixed(1)}%)`,
    );
  }

  const unpriced = rows.filter((row) => row.price_source !== 'ENDING_INVENTORY');
  console.log(`\n  [참고] 단가 미확보 ${unpriced.length}행 / 전체 ${rows.length}행`);
  const byMonth = new Map();
  rows.forEach((row) => {
    if (!row.price_month) return;
    byMonth.set(row.price_month, (byMonth.get(row.price_month) || 0) + 1);
  });
  [...byMonth.entries()].sort().reverse().forEach(([month, count]) => {
    console.log(`    단가 기준월 ${month}: ${count}행`);
  });
}

console.log(failed === 0 ? '\n✅ 전부 통과\n' : `\n❌ ${failed}건 실패\n`);
process.exit(failed === 0 ? 0 : 1);
