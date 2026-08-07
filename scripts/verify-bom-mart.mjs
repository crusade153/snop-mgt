/**
 * BOM 마트 · 자재 귀속 읽기 전용 검증
 *
 * 이 저장소에는 테스트 프레임워크가 없다. 대신 앱이 실제로 쓰는 모듈을 그대로 불러
 * 실데이터로 돌려보고 불변식을 확인한다. 아무 것도 쓰지 않는다(SELECT 전용).
 *
 *   node scripts/verify-bom-mart.mjs
 *
 * 확인하는 것
 *   1. BOM 전개가 도는가, 규모·레벨 분포가 상식적인가
 *   2. 완제품 1개당 소요량이 손계산과 맞는가 (N개입 박스 = 1/N)
 *   3. 발주 테이블의 입고문서 중복이 GROUP BY 로 제거되는가
 *   4. 귀속 배분에 중복·누락이 없는가 (지분합 1, 배분금액 합 = 실제 재고금액)
 */

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(ROOT + '/').href;

// '@/...' 별칭을 프로젝트 루트로 풀어준다. Next 빌드 밖에서는 tsconfig paths 가 안 먹는다.
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

const { BigQuery } = await import(
  pathToFileURL(`${ROOT}/node_modules/@google-cloud/bigquery/build/src/index.js`).href
);
const { buildBomExplosionQuery, MAX_BOM_LEVEL, MATERIAL_CLASS_LABEL } = await import(
  '@/lib/bom/explosion-sql'
);
const { toBomLeafRow } = await import('@/lib/bom/leaf');
const { allocateMaterials, buildableQuantity, describeRiskCriteria, DEFAULT_THRESHOLDS } =
  await import('@/lib/material/allocation');
const { classifyMaterialInventory, describeMaterialStatuses } =
  await import('@/lib/material/inventory-status');
const { buildMaterialRequirementQuery } = await import('@/lib/material/requirement-sql');
const queries = await import('@/lib/material/queries');

const bq = new BigQuery({
  projectId: process.env.GOOGLE_PROJECT_ID || 'harimfood-361004',
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: String(process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, '\n'),
  },
});

const ymd = (date) =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
const won = (value) => `₩${Math.round(value).toLocaleString()}`;
const sum = (list, pick) => list.reduce((acc, item) => acc + pick(item), 0);

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const today = new Date();
const poCutoff = new Date(today);
poCutoff.setDate(poCutoff.getDate() - queries.PO_OVERDUE_CUTOFF_DAYS);
const usageFrom = new Date(today);
usageFrom.setMonth(usageFrom.getMonth() - 12);
const recentProductionFrom = new Date(today);
recentProductionFrom.setMonth(recentProductionFrom.getMonth() - 3);

console.log('\n■ 1. BOM 전개');
const startedAt = Date.now();
const [bomRows] = await bq.query({
  query: buildBomExplosionQuery('RAW_AND_PACKAGING'),
  params: { maxLevel: MAX_BOM_LEVEL, plants: [] },
  types: { maxLevel: 'INT64', plants: ['STRING'] },
});
const bomLeaf = bomRows.map(toBomLeafRow);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

const levels = {};
bomLeaf.forEach((row) => {
  levels[row.minLevel] = (levels[row.minLevel] ?? 0) + 1;
});
console.log(
  `  ${bomLeaf.length.toLocaleString()}행 / ${elapsed}초 · ` +
    `완제품 ${new Set(bomLeaf.map((r) => r.rootMatnr)).size.toLocaleString()} · ` +
    `자재 ${new Set(bomLeaf.map((r) => r.materialCode)).size.toLocaleString()}`,
);
const classCounts = {};
bomLeaf.forEach((row) => {
  const label = MATERIAL_CLASS_LABEL[row.materialClass] ?? row.materialClass;
  classCounts[label] = (classCounts[label] ?? 0) + 1;
});
console.log(`  자재 구분 ${JSON.stringify(classCounts)}`);
console.log(`  레벨 분포 ${JSON.stringify(levels)}`);
check(
  '원재료·부재료·포장재가 모두 잡힌다',
  ['1', '2', '3'].every((code) => bomLeaf.some((row) => row.materialClass === code)),
);
check('전개 결과가 비어 있지 않다', bomLeaf.length > 0);
check(
  '반제품을 거치는 자재가 잡힌다 (레벨 2 이상)',
  bomLeaf.some((row) => row.minLevel >= 2),
  `${bomLeaf.filter((r) => r.minLevel >= 2).length.toLocaleString()}행`,
);
check(
  '깊이 상한에 걸린 행이 거의 없다',
  bomLeaf.filter((r) => r.hitDepthCap).length < bomLeaf.length * 0.01,
  `${bomLeaf.filter((r) => r.hitDepthCap).length}행`,
);
check('소요량이 음수인 행이 없다', bomLeaf.every((row) => row.qtyPerFg >= 0));

console.log('\n■ 2. 손계산 대조 — "(N/box)" 제품에는 1/N 로 들어가는 외박스가 있어야 한다');
// 자재명으로 외박스를 집으면 안 된다. 한 제품에 '번들지함'(묶음당 1개)과
// '지박스'(N묶음당 1개)가 같이 들어가는 구성이 실제로 있어서, 이름만 보면
// 안쪽 슬리브를 외박스로 오인한다. 대신 "그 제품의 1단계 자재 중 1/N 인 것이
// 하나라도 있는가"를 본다 — 수량 계산이 맞으면 반드시 성립하는 관계다.
// 후보는 "1단계로 직접 들어가는 포장재 중 이름에 박스류가 든 것"으로 좁힌다.
// 원·부자재는 개당 소요가 제각각이라 섞으면 우연히 맞거나 틀리는 잡음이 된다.
// 박스류가 아예 없는 제품(벌크·TOTE)은 표본에서 빼야지 실패로 세면 안 된다.
const BOXLIKE = /박스|지함|케이스|카톤/;
const byRoot = new Map();
for (const row of bomLeaf) {
  if (row.minLevel !== 1 || row.suspectLotBasis) continue;
  if (row.materialClass !== '3' || !BOXLIKE.test(row.materialName)) continue;
  const match = row.rootName.match(/\((\d+)\s*\/\s*box\)/i);
  if (!match) continue;
  const perBox = Number(match[1]);
  if (!(perBox > 1)) continue;
  const key = `${row.werks}|${row.rootMatnr}`;
  if (!byRoot.has(key)) byRoot.set(key, { row, perBox, quantities: [] });
  byRoot.get(key).quantities.push({ name: row.materialName, qty: row.qtyPerFg });
}

// 표본 비율로 판정한다. 개별 제품이 외박스를 안 갖는 경우가 실제로 있기 때문이다
// (예: TOTE 벌크 제품은 파우치·라벨만 있고 낱개 박스가 없다). 수량 계산이 틀리면
// 비율이 뚝 떨어지므로, 개별 예외는 넘어가되 전체 경향은 잡힌다.
const boxSamples = [...byRoot.values()].slice(0, 40);
if (!boxSamples.length) {
  console.log('  (대조 가능한 샘플을 찾지 못했습니다 — 제품명 규칙이 바뀌었을 수 있습니다)');
} else {
  const misses = [];
  let hits = 0;
  for (const { row, perBox, quantities } of boxSamples) {
    const expected = 1 / perBox;
    const hit = quantities.find((item) => Math.abs(item.qty - expected) < expected * 0.05);
    if (hit) {
      hits += 1;
      if (hits <= 4) {
        console.log(
          `    ${row.rootMatnr} (${perBox}개입) · ${hit.name.slice(0, 26)} = ${hit.qty.toFixed(4)} ≈ 1/${perBox}`,
        );
      }
    } else {
      misses.push(`${row.rootMatnr} ${row.rootName.slice(0, 26)} (${perBox}개입) → [${quantities.map((q) => q.qty.toFixed(3)).join(', ')}]`);
    }
  }
  check(
    `표본 ${boxSamples.length}건 중 ${hits}건이 1/N 외박스를 가진다`,
    hits / boxSamples.length >= 0.7,
    `${((hits / boxSamples.length) * 100).toFixed(0)}%`,
  );
  if (misses.length) {
    console.log(`  ℹ 1/N 자재가 없는 ${misses.length}건 (외박스 없는 벌크 제품이면 정상):`);
    misses.slice(0, 5).forEach((line) => console.log(`    · ${line}`));
  }
}

console.log('\n■ 3. 발주 행 중복 (MM_ZMMR0020)');
const [[dupRow]] = await bq.query({
  query: `
    SELECT COUNT(*) AS raw_rows,
           COUNT(DISTINCT CONCAT(CAST(EBELN AS STRING), '-', CAST(EBELP AS STRING))) AS items
    FROM \`${queries.DATASET}.MM_ZMMR0020\`
  `,
});
const dupFactor = Number(dupRow.raw_rows) / Number(dupRow.items);
console.log(
  `  원본 ${Number(dupRow.raw_rows).toLocaleString()}행 / 고유 PO아이템 ${Number(dupRow.items).toLocaleString()}건 = ${dupFactor.toFixed(2)}배`,
);
check('입고문서별 행 중복이 실재한다 (GROUP BY 가 필요하다)', dupFactor > 1.5);

console.log('\n■ 4. 자재 사실 + 귀속');
const [[stockRows], [poRows], [reqRows], [productUsageRows]] = await Promise.all([
  bq.query({
    query: queries.buildMaterialStockQuery(),
    params: { fromDate: ymd(usageFrom), toDate: ymd(today) },
    types: { fromDate: 'STRING', toDate: 'STRING' },
  }),
  bq.query({
    query: queries.buildOpenPoQuery(),
    params: { todayInt: Number(ymd(today)), overdueCutoff: Number(ymd(poCutoff)) },
    types: { todayInt: 'INT64', overdueCutoff: 'INT64' },
  }),
  bq.query({
    query: buildMaterialRequirementQuery('RAW_AND_PACKAGING'),
    params: {
      maxLevel: MAX_BOM_LEVEL,
      plants: [],
      fromDate: ymd(usageFrom),
      toDate: ymd(today),
    },
    types: { maxLevel: 'INT64', plants: ['STRING'], fromDate: 'STRING', toDate: 'STRING' },
  }),
  bq.query({
    query: queries.buildProductUsageQuery(),
    params: { fromDate: ymd(recentProductionFrom), toDate: ymd(today) },
    types: { fromDate: 'STRING', toDate: 'STRING' },
  }),
]);
const facts = queries.mergeMaterialFacts(stockRows, poRows);
const requirements = queries.toMaterialRequirements(reqRows);
const productUsage = queries.toProductUsage(productUsageRows);
const traderRiceBox = productUsage.find((row) => row.werks === '1021' && row.matnr === '50005706');
const traderRiceInner = productUsage.find((row) => row.werks === '1021' && row.matnr === '50005715');
check(
  '완제품 50005706 최근 생산오더 입고가 BOX→EA 환산되어 집계된다',
  traderRiceBox?.actualQty === 7758,
  `${traderRiceBox?.actualQty ?? 0} EA`,
);
check(
  '완제품 50005715 최근 생산오더 입고가 집계된다',
  traderRiceInner?.actualQty === 38790,
  `${traderRiceInner?.actualQty ?? 0} EA`,
);
const factsBytes = Buffer.byteLength(JSON.stringify(facts));
check(
  'MB51 사용량을 포함한 자재 사실 캐시가 2MB 제한 안에 든다',
  factsBytes < 2 * 1024 * 1024,
  `${(factsBytes / 1024 / 1024).toFixed(2)} MB`,
);
const beefTrim = facts.find((row) => row.werks === '1021' && row.materialCode === '10000437');
check(
  '한우잡육(10000437) 최근 3개월 MB51 261-262 사용량이 반영된다',
  Math.abs((beefTrim?.actualUsageByMonths?.[3] ?? 0) - 379.7) < 0.001,
  `${beefTrim?.actualUsageByMonths?.[3] ?? 0} KG`,
);
const usBeefCut = facts.find((row) => row.werks === '1021' && row.materialCode === '10000585');
check(
  '조각정육 미국산(10000585)은 PP_STPO 직접 BOM 9개에 등록되어 있다',
  usBeefCut?.directBomParentCount === 9,
  `${usBeefCut?.directBomParentCount ?? 0}개`,
);

// 집계본이 리프와 같은 모수를 보는지 — 두 쿼리가 갈리면 화면끼리 숫자가 어긋난다.
const leafMaterials = new Set(bomLeaf.map((row) => `${row.werks}|${row.materialCode}`));
const reqMaterials = new Set(requirements.map((row) => `${row.werks}|${row.materialCode}`));
// ⚠️ 이 집계는 unstable_cache 에 gzip 해서 넣는다. 항목 2MB 를 넘으면 저장이 조용히
//    실패하고 매 요청 BigQuery 전개를 다시 때린다(purchase 가 3개월간 당한 버그).
const rawBytes = JSON.stringify(requirements).length;
const gzBytes = gzipSync(JSON.stringify(requirements), { level: 9 }).toString('base64').length;
console.log(
  `  소요량 집계 ${requirements.length.toLocaleString()}행 (자재×공장×제품계층) · ` +
    `원본 ${(rawBytes / 1024 / 1024).toFixed(2)} MB → gzip+base64 ${(gzBytes / 1024 / 1024).toFixed(2)} MB`,
);
check(
  'gzip 후 캐시 항목 2MB 제한 안에 든다',
  gzBytes < 2 * 1024 * 1024,
  `${((gzBytes / (2 * 1024 * 1024)) * 100).toFixed(0)}% 사용`,
);
check(
  '집계본과 리프의 자재 모수가 같다',
  leafMaterials.size === reqMaterials.size,
  `리프 ${leafMaterials.size} / 집계 ${reqMaterials.size}`,
);

// 실제 담당자 매핑은 Supabase 에 있고 여기서는 못 읽는다(next/headers 의존).
// 대신 브랜드마다 가상 담당자를 붙여 공용 배분 경로까지 태운다.
const brands = [...new Set(bomLeaf.map((row) => row.rootBrand).filter(Boolean))];
const owners = brands.map((brand, index) => ({
  id: `verify-${index}`,
  scopeType: 'BRAND',
  scopeKey: brand,
  ownerId: `owner-${index}`,
  ownerName: `가상담당 ${brand}`,
  ownerTeam: null,
  role: 'PRIMARY',
}));

const { insights } = allocateMaterials({ requirements, facts, owners });
const stockTotal = sum(insights, (item) => item.stockValue);
const allocTotal = sum(insights, (item) => sum(item.owners, (owner) => owner.allocatedValue));
const badShare = insights.filter(
  (item) => Math.abs(sum(item.owners, (owner) => owner.share) - 1) > 1e-9,
);
const outOfRange = insights.filter((item) =>
  item.owners.some((owner) => owner.share < 0 || owner.share > 1),
);

console.log(
  `  자재×공장 ${insights.length.toLocaleString()}건 · 전용 ${insights.filter((i) => i.kind === 'DEDICATED').length.toLocaleString()} · 공용 ${insights.filter((i) => i.kind === 'SHARED').length.toLocaleString()}`,
);
console.log(`  총 재고금액 ${won(stockTotal)} · 총 미입고발주 ${won(sum(insights, (i) => i.openPoValue))}`);
const criteria = describeRiskCriteria(DEFAULT_THRESHOLDS);
for (const kind of ['DISCONTINUED_ONLY', 'DEAD', 'EXCESS', 'OVER_ORDERED']) {
  const hit = insights.filter((item) => item.risks.includes(kind));
  const value = sum(hit, (item) => (kind === 'OVER_ORDERED' ? item.openPoValue : item.stockValue));
  console.log(
    `  ${criteria[kind].label.padEnd(6)} ${String(hit.length).padStart(5)}건 ${won(value).padStart(16)}  ← ${criteria[kind].formula}`,
  );
}

const simulationSettings = { usageMonths: 3, excessMonths: 3 };
const statusCriteria = describeMaterialStatuses(simulationSettings);
const classified = insights.map((item) => ({
  item,
  result: classifyMaterialInventory(item, simulationSettings),
}));
const beefTrimClassified = classified.find(
  ({ item }) => item.werks === '1021' && item.materialCode === '10000437',
);
check(
  '한우잡육(10000437)은 최근 사용 이력이 있어 부진재고가 아니다',
  Boolean(beefTrimClassified && beefTrimClassified.result.status !== 'SLOW_MOVING'),
  beefTrimClassified?.result.status ?? '미조회',
);
const usBeefCutClassified = classified.find(
  ({ item }) => item.werks === '1021' && item.materialCode === '10000585',
);
check(
  '조각정육 미국산(10000585)은 BOM 등록 자재로 판정된다',
  Boolean(
    usBeefCutClassified?.item.bomRegistered && usBeefCutClassified.item.productCount === 9,
  ),
  `${usBeefCutClassified?.item.productCount ?? 0}개 사용처`,
);
check(
  '조각정육 미국산(10000585)은 최근 사용이 없어 불용이 아닌 부진재고다',
  usBeefCutClassified?.result.status === 'SLOW_MOVING',
  usBeefCutClassified?.result.status ?? '미조회',
);
for (const status of ['ACTIVE', 'EXCESS', 'SLOW_MOVING', 'OBSOLETE']) {
  const hit = classified.filter(({ result }) => result.status === status);
  console.log(
    `  ${statusCriteria[status].label.padEnd(6)} ${String(hit.length).padStart(5)}건 ${won(sum(hit, ({ result }) => result.statusValue)).padStart(16)}  ← ${statusCriteria[status].formula}`,
  );
}
check(
  '모든 자재가 정상·과잉·부진·불용 중 정확히 하나로 분류된다',
  classified.length === insights.length && classified.every(({ result }) => Boolean(statusCriteria[result.status])),
);
check(
  'BOM 미등록 자재는 모두 불용으로 분류된다',
  classified.every(({ item, result }) => item.bomRegistered || result.status === 'OBSOLETE'),
);
const directOnly = classified.filter(({ item }) =>
  item.dataWarnings.includes('활성 완제품 경로 없음'),
);
check(
  '직접 BOM은 있으나 활성 완제품 경로가 없는 자재도 BOM 등록으로 유지된다',
  directOnly.length > 0 && directOnly.every(({ item }) => item.bomRegistered),
  `${directOnly.length.toLocaleString()}건`,
);
const classified12 = insights.map((item) =>
  classifyMaterialInventory(item, { usageMonths: 12, excessMonths: 12 }),
);
const changedBySlider = classified12.filter((result, index) => result.status !== classified[index].result.status);
check(
  '3개월→12개월 슬라이더 변경이 실데이터 분류에 반영된다',
  changedBySlider.length > 0,
  `${changedBySlider.length.toLocaleString()}건 상태 변경`,
);
check(
  '사용 이력 기간을 늘리면 부진재고가 늘어나지 않는다',
  classified12.filter((result) => result.status === 'SLOW_MOVING').length <=
    classified.filter(({ result }) => result.status === 'SLOW_MOVING').length,
);
check(
  '예상 소요 기간을 늘리면 과잉재고가 늘어나지 않는다',
  classified12.filter((result) => result.status === 'EXCESS').length <=
    classified.filter(({ result }) => result.status === 'EXCESS').length,
);
// 단종과 사장은 배타여야 한다. 둘 다 붙으면 판정이 겹쳐 금액이 이중 계상된다.
check(
  '단종 전용과 사장 재고가 겹치지 않는다',
  insights.every(
    (item) => !(item.risks.includes('DISCONTINUED_ONLY') && item.risks.includes('DEAD')),
  ),
);

check('모든 자재의 담당자 지분 합이 1이다', badShare.length === 0, `${badShare.length}건 위반`);
check('지분이 0~1 범위 안에 있다', outOfRange.length === 0, `${outOfRange.length}건 위반`);
check(
  '배분금액 합계 = 실제 재고금액 (중복·누락 없음)',
  Math.abs(allocTotal - stockTotal) < 1,
  `차이 ${won(allocTotal - stockTotal)}`,
);
check(
  '모든 자재에 담당자가 최소 한 명 있다',
  insights.every((item) => item.owners.length > 0),
);

console.log('\n■ 5. 생산가능수량');
const sample = insights
  .filter((item) => item.onHand > 0 && item.dataWarnings.length === 0)
  .sort((a, b) => b.stockValue - a.stockValue)[0];
if (sample) {
  const rows = bomLeaf.filter(
    (row) => row.materialCode === sample.materialCode && row.werks === sample.werks,
  );
  console.log(
    `  ${sample.materialCode} ${sample.materialName} · 재고 ${Math.round(sample.onHand).toLocaleString()} ${sample.unit}`,
  );
  let ok = true;
  for (const row of rows.slice(0, 5)) {
    const computed = buildableQuantity(sample.onHand, row.qtyPerFg);
    const expected = Math.floor(sample.onHand / row.qtyPerFg);
    if (computed !== expected) ok = false;
    console.log(
      `    ${row.rootMatnr} 개당 ${row.qtyPerFg.toFixed(5)} → ${computed?.toLocaleString()}개` +
        (row.minLevel > 1 ? ` (경유 ${row.viaPaths.join(' / ')})` : ''),
    );
  }
  check('생산가능수량이 재고÷개당소요와 일치한다', ok);
}

console.log(
  failures === 0
    ? '\n✅ 모든 검증 통과\n'
    : `\n❌ ${failures}건 실패 — 위 항목을 확인하세요\n`,
);
process.exit(failures === 0 ? 0 : 1);
