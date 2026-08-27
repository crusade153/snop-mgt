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
 *   6. 카테고리 드릴다운 상세 합계가 메인 표의 그 줄과 같은가 (모수가 갈리면 안 된다)
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

const {
  weekRangeOf, completedWeekOf, previousWeekEnd, isWeekEnd, monthToDateRange,
  canReplaceMidWeekStock,
} = await import('@/lib/weekly/week');
const {
  categoryOfDispo, plantOfDispo, cmOfCategory, storageScopeOfLgort, isFbhMirrorLocation,
  pickPrimaryDispo, pickFallbackDispo,
} = await import('@/lib/weekly/classification');
const { buildDispoMasterQuery } = await import('@/lib/weekly/queries');
const { buildWeeklyBoard, buildWeeklyDetail, resolveCm, sumBuckets } = await import('@/lib/weekly/board');

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

console.log('\n[1-1] 주중 잠정 재고 교체 판정 (소급 불가 원칙)');
{
  // 8/17~8/23 주차를 주중(8/20)에 적재해 뒀다.
  const midWeek = '2026-08-20T00:31:13Z';

  // 월요일 cron(= 마감 다음 날)은 그 잠정치를 마감 재고로 갈아끼운다.
  check('마감 다음 날이면 교체', canReplaceMidWeekStock('2026-08-23', midWeek, '2026-08-24'));

  // ⚠️ 실제로 터뜨렸던 버그. 시간 상한이 없으면 며칠 뒤 적재가
  //    「그때의 재고」 자리에 「지금 재고」를 밀어 넣는다.
  check('이틀 뒤부터는 교체 금지', !canReplaceMidWeekStock('2026-08-23', midWeek, '2026-08-25'));
  check('몇 주 뒤도 교체 금지', !canReplaceMidWeekStock('2026-08-23', midWeek, '2026-09-14'));

  // 마감 후에 찍힌 재고는 확정본이라 언제든 덮지 않는다.
  check('마감 후 적재분은 덮지 않음',
    !canReplaceMidWeekStock('2026-08-23', '2026-08-24T00:31:13Z', '2026-08-24'));

  // 경계: 일요일 KST 자정 직전은 잠정, 직후는 확정.
  check('경계 = 일요일 KST 자정',
    canReplaceMidWeekStock('2026-08-23', '2026-08-23T14:59:00Z', '2026-08-24') &&
    !canReplaceMidWeekStock('2026-08-23', '2026-08-23T15:01:00Z', '2026-08-24'));

  check('적재 이력이 없으면 판정 대상 아님', !canReplaceMidWeekStock('2026-08-23', null, '2026-08-24'));
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
  check('M18 → 즉석밥/K2 (SKU 가 전부 쌀밥이라 확정한 매핑)',
    categoryOfDispo('M18') === '즉석밥' && plantOfDispo('M18') === 'K2');
  check('영업 코드·마스터정비는 기타',
    categoryOfDispo('M33') === '기타' && categoryOfDispo('M36') === '기타' &&
    categoryOfDispo('') === '기타' && categoryOfDispo(null) === '기타');

  // 자재 하나에 DISPO 가 여럿일 때의 대표값 선택.
  // 미매핑 코드가 앞자리를 차지해 품목 전체가 기타로 떨어지던 버그를 막는 규칙이다.
  check('여러 DISPO 중 분류되는 코드를 대표로',
    pickPrimaryDispo(['M33', 'M30']) === 'M30' && pickPrimaryDispo(['M36', 'A08']) === 'A08');
  check('분류되는 코드가 둘이면 첫 번째 유지 (기존 분류를 흔들지 않는다)',
    pickPrimaryDispo(['A08', 'M11']) === 'A08' && pickPrimaryDispo(['A06', 'M19']) === 'A06');
  check('전부 미매핑이면 첫 값 그대로 (없는 분류를 지어내지 않는다)',
    pickPrimaryDispo(['M33', 'M36']) === 'M33' && pickPrimaryDispo([null, '', undefined]) === null);

  // 판매법인(1031) 폴백은 상품(H01)만 받는다. 영업 코드가 생산라인 자리를 차지하면 안 된다.
  check('판매법인 폴백은 H01(상품)만', pickFallbackDispo(['M33', 'H01', 'M36']) === 'H01');
  check('영업 코드만 있으면 폴백 없음 (기타로 남긴다)',
    pickFallbackDispo(['M33', 'M36', 'M34']) === null && pickFallbackDispo([]) === null);
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

  const quantityMismatched = rows.filter((row) => {
    const bucketSum =
      row.bucket_qty_under50 + row.bucket_qty_50_70 + row.bucket_qty_70_75 +
      row.bucket_qty_75_85 + row.bucket_qty_85_over;
    return Math.abs(bucketSum - row.stock_qty) > 0.01;
  });
  check('구간 수량 합 = 재고수량', quantityMismatched.length === 0,
    quantityMismatched.length ? `${quantityMismatched.length}행 불일치 (예: ${quantityMismatched[0].material_code})` : '전 행 일치');

  // 출고·생산·매출은 SKU 당 한 창고그룹에만 실려야 한다(창고그룹으로 나눌 수 없는 값이라서).
  const flowScopes = new Map();
  rows.forEach((row) => {
    if (row.shipped_qty === 0 && row.produced_qty === 0 && row.shipped_mtd_qty === 0) return;
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

  // 대표 DISPO 선택이 실데이터에서도 지켜지는가.
  // 한 자재가 여러 플랜트에 걸리면 DISPO 가 여러 개 오는데(실측 836품목 중 72품목),
  // 그중 분류되는 코드가 하나라도 있으면 절대 기타로 떨어지면 안 된다.
  const bigqueryClient = (await import('@/lib/bigquery')).default;
  const [masterRows] = await bigqueryClient.query({ query: buildDispoMasterQuery() });
  const multi = masterRows.filter((row) => (row.CANDIDATES || []).length > 1);
  check('DISPO 후보가 배열로 온다', masterRows.length > 0 && multi.length > 0,
    `${masterRows.length}품목 중 ${multi.length}품목이 복수 DISPO`);

  const wrongly = masterRows.filter((row) => {
    const candidates = (row.CANDIDATES || []).map((candidate) => candidate.DISPO);
    return categoryOfDispo(pickPrimaryDispo(candidates)) === '기타' &&
      candidates.some((dispo) => categoryOfDispo(dispo) !== '기타');
  });
  check('분류 가능한 DISPO 가 있는데 기타로 떨어진 자재 없음', wrongly.length === 0,
    wrongly.length ? `${wrongly.length}품목 (예: ${wrongly[0].MATNR})` : '전 품목 통과');

  // 판매법인 폴백은 상품에만 걸려야 한다. 생산 후보가 없는 SKU 에 DISPO 가 붙었다면 H01 뿐이다.
  const hasProduction = new Set(
    masterRows.filter((row) => (row.CANDIDATES || []).length > 0).map((row) => String(row.MATNR))
  );
  const fallbackRows = rows.filter((row) => row.dispo && !hasProduction.has(row.material_code));
  const leaked = fallbackRows.filter((row) => row.dispo !== 'H01' || row.category !== '상품');
  check('판매법인 폴백은 H01(상품)만 통과', leaked.length === 0,
    leaked.length ? `${leaked.length}행 (예: ${leaked[0].material_code} ${leaked[0].dispo})` : `${fallbackRows.length}행이 상품으로 들어옴`);

  // 적재 행에도 그대로 반영되는가 (실측 사례: 1022:M18 + 1023:M30 → 둘 다 즉석밥)
  const sample = rows.filter((row) => row.material_code === '50001591');
  check('50001591(M18+M30) → 즉석밥/K2',
    sample.length === 0 || sample.every((row) => row.category === '즉석밥' && row.plant === 'K2'),
    sample.length ? `${sample[0].dispo} / ${sample[0].category}` : '해당 주차에 행 없음');
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


console.log('\n[6] 카테고리 드릴다운 상세 (메인 표와 모수가 같아야 한다)');
{
  const cmMapping = new Map();
  const scopes = [];
  const board = buildWeeklyBoard({ current: rows, previous: [], cmMapping, scopes });

  // 상세표는 위 표의 한 칸을 펼친 것이다. 합계가 어긋나면 사용자가 어느 쪽을 믿어야 할지 알 수 없다.
  let worstGap = 0;
  let worstLabel = '';
  board.rows.forEach((boardRow) => {
    const detail = buildWeeklyDetail({
      current: rows,
      previous: [],
      cmMapping,
      scopes,
      category: boardRow.category,
      cm: boardRow.cm,
    });
    const gap = Math.abs(detail.totals.stockValue - boardRow.stockValue);
    if (gap > worstGap) {
      worstGap = gap;
      worstLabel = `${boardRow.cm} ${boardRow.category}`;
    }
  });
  check('상세 합계 = 메인 표 그 줄', worstGap < 5,
    worstGap === 0 ? '전 칸 일치' : `최대 ${Math.round(worstGap)}원 차이 (${worstLabel})`);

  // 카테고리 전체(cm 미지정)로 펼쳤을 때는 그 카테고리의 모든 CM 행 합과 같아야 한다.
  const categoryGaps = [];
  [...new Set(board.rows.map((row) => row.category))].forEach((category) => {
    const expected = board.rows
      .filter((row) => row.category === category)
      .reduce((sum, row) => sum + row.stockValue, 0);
    const detail = buildWeeklyDetail({ current: rows, previous: [], cmMapping, scopes, category });
    if (Math.abs(detail.totals.stockValue - expected) > 5) categoryGaps.push(category);
  });
  check('카테고리 전체 = 그 카테고리 CM 행 합', categoryGaps.length === 0,
    categoryGaps.length ? categoryGaps.join(', ') : '전 카테고리 일치');

  // SKU 는 한 줄로 접혀야 한다. 창고그룹별로 쪼개지면 같은 제품이 두 번 나온다.
  const all = buildWeeklyDetail({ current: rows, previous: [], cmMapping, scopes });
  const codes = all.rows.map((row) => row.materialCode);
  check('상세는 SKU 당 한 줄', codes.length === new Set(codes).size,
    `${codes.length.toLocaleString('ko-KR')}줄`);

  // 소진필요 = 잔여율 75% 미만 세 구간의 합. 메인 표의 「소진 필요」와 같은 정의여야 한다.
  const riskMismatch = all.rows.filter(
    (row) => Math.abs(row.riskValue - (row.buckets.under50 + row.buckets.r50_70 + row.buckets.r70_75)) > 1,
  );
  check('소진필요 = 잔여율 75% 미만', riskMismatch.length === 0);
  check('상세 구간 수량 사용 가능', all.hasBucketQuantities);

  const ratioMismatch = board.rows.filter((row) =>
    row.salesMtd > 0
      ? Math.abs(row.stockToSalesRatio - row.stockValue / row.salesMtd) > 1e-9
      : row.stockToSalesRatio !== null,
  );
  check('월 매출 比 = 재고금액 ÷ 실제 월 매출액', ratioMismatch.length === 0);

  // ⚠️ 잔여일이 없는 재고(기한없음)를 0 으로 채우면 '오늘 폐기'로 맨 위에 온다. null 로 남아야 한다.
  const zeroDay = all.rows.filter((row) => row.minRemainDay === 0);
  const withDay = all.rows.filter((row) => row.minRemainDay !== null);
  check('소비기한 잔여일이 채워짐', withDay.length > 0,
    `${withDay.length.toLocaleString('ko-KR')}/${all.rows.length.toLocaleString('ko-KR')} SKU`);
  check('기한없음 재고는 0 이 아니라 null', zeroDay.length < all.rows.length * 0.05,
    `잔여일 0 인 SKU ${zeroDay.length}개 (실제 폐기 대상일 수 있음)`);

  // 잔여율은 % 단위여야 한다.
  // ⚠️ 상한으로는 검증할 수 없다 — 실측에 130% 초과(유통기한 연장 배치)와 음수(기한 경과)가 정상적으로 있고,
  //    기타 창고에는 3112% 같은 마스터 오류도 섞여 있다. 그래서 **분포가 0~1 에 몰렸는지**만 본다.
  //    normalizeRate(0~1 로 오는 원본 행을 100 배) 가 빠지면 전 행이 '50% 미만'으로 오분류되는데,
  //    그 사고는 값 하나가 아니라 분포로만 드러난다.
  const rated = all.rows.filter((row) => row.avgRemainRate !== null);
  const ratioScale = rated.filter((row) => row.avgRemainRate > 0 && row.avgRemainRate <= 1);
  check('잔여율이 % 스케일 (0~1 에 몰리지 않음)', ratioScale.length < rated.length * 0.05,
    `0~1 구간 ${ratioScale.length} / 전체 ${rated.length}`);
  check('잔여율 중앙값이 상식적(20~90%)',
    (() => {
      const sorted = rated.map((row) => row.avgRemainRate).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      return median > 20 && median < 90;
    })(),
    `중앙값 ${rated.length ? rated.map((r) => r.avgRemainRate).sort((a, b) => a - b)[Math.floor(rated.length / 2)].toFixed(1) : '-'}%`);

  // 기본 화면(플랜트+물류)의 폐기·임박 재고금액은 소진 계획의 출발점이라 눈으로 확인한다.
  const mainScope = buildWeeklyDetail({
    current: rows,
    previous: [],
    cmMapping,
    scopes: ['PLANT', 'LOGISTICS'],
  });
  const sumOf = (list) => Math.round(list.reduce((sum, row) => sum + row.stockValue, 0)).toLocaleString('ko-KR');
  const expired = mainScope.rows.filter((row) => row.minRemainDay !== null && row.minRemainDay <= 0);
  const soon30 = mainScope.rows.filter(
    (row) => row.minRemainDay !== null && row.minRemainDay > 0 && row.minRemainDay <= 30,
  );
  console.log(
    `
  [참고] 기본 스코프 폐기(≤0일) ${expired.length} SKU ${sumOf(expired)} 원 · ` +
    `임박(1~30일) ${soon30.length} SKU ${sumOf(soon30)} 원`,
  );

  const soon = all.rows
    .filter((row) => row.minRemainDay !== null)
    .sort((a, b) => a.minRemainDay - b.minRemainDay)
    .slice(0, 5);
  console.log('\n  [참고] 소비기한 임박 상위 5');
  soon.forEach((row) => {
    console.log(
      `    ${row.materialCode} ${String(row.productName).slice(0, 22).padEnd(24)}` +
      ` 잔여 ${String(Math.round(row.minRemainDay)).padStart(5)}일` +
      ` 재고 ${Math.round(row.stockValue).toLocaleString('ko-KR').padStart(13)} 원` +
      ` (${row.category})`,
    );
  });
}

console.log(failed === 0 ? '\n✅ 전부 통과\n' : `\n❌ ${failed}건 실패\n`);
process.exit(failed === 0 ? 0 : 1);
