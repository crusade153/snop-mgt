/**
 * 재고 장표 ADS 검증 — 읽기 전용
 *
 * ADS 는 납품출고(SD_ZASSDDV0020)만이 아니라 생산투입 순소요(MM_MB51 261-262)를 더한 값이다.
 * 스프·양념장처럼 제품 코드(5xxxxxxx)로 등록됐지만 다시 다른 제품의 자재로 투입되는 품목이
 * 판매출고만 보면 '소진 0' 으로 잡혀 회전일이 영원히 비어 있었기 때문이다.
 *
 *   npm run verify:ads
 *
 * 확인하는 것
 *   1. 합산은 단조 증가다 (ADS 가 줄어드는 품목이 없다)
 *   2. 262 취소가 261 투입을 넘겨도 음수 ADS 가 나오지 않는다
 *   3. 판매 0 이라 회전일이 비어 있던 재고 품목이 실제로 계산된다
 *   4. ADS = 판매분 + 투입분 항등식이 성립한다
 *   5. gzip 후 캐시 항목이 2MB 제한 안에 든다 (넘으면 저장이 조용히 실패한다)
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(ROOT + '/').href;

// '@/...' 별칭을 프로젝트 루트로 풀어준다. Next 빌드 밖에서는 tsconfig paths 가 안 먹는다.
// ⚠️ 이 훅은 최상위 import 에만 걸린다. 불러오는 모듈이 타입을 값 import 로 들고 있으면
//    스트리핑 후에도 import 문이 남아 여기서 못 푼다 — lib/analysis.ts 는 전부 `import type` 이다.
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
const { analyzeSnopData } = await import('@/lib/analysis');

const bq = new BigQuery({
  projectId: process.env.GOOGLE_PROJECT_ID || 'harimfood-361004',
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: String(process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, '\n'),
  },
});

const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const start = new Date(today);
start.setDate(start.getDate() - 90);
const FROM = ymd(start);
const TO = ymd(today);

const query = async (sql) => (await bq.query({ query: sql }))[0];

// actions/dashboard-actions.ts 의 쿼리를 그대로 쓴다(재고는 배치 마스터 조인만 생략).
const [orders, inventory, consumptions] = await Promise.all([
  query(`
    SELECT A.VBELN, A.POSNR, A.MATNR, A.ARKTX, A.NETWR, A.WAERK, A.VDATU, A.NAME1, A.KUNNR, A.WERKS, A.LGORT,
      CASE WHEN A.VRKME='BOX' AND M.MEINS<>'BOX' THEN A.KWMENG*IFNULL(M.UMREZ_BOX,1) ELSE A.KWMENG END as KWMENG,
      CASE WHEN A.VRKME='BOX' AND M.MEINS<>'BOX' THEN IFNULL(A.LFIMG_LIPS,0)*IFNULL(M.UMREZ_BOX,1) ELSE IFNULL(A.LFIMG_LIPS,0) END as LFIMG_LIPS,
      M.MEINS, IFNULL(M.UMREZ_BOX,1) as UMREZ_BOX
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` M ON A.MATNR = M.MATNR
    WHERE A.VDATU BETWEEN '${FROM}' AND '${TO}' AND A.MATNR BETWEEN '50000000' AND '69999999'
  `),
  query(`
    SELECT I.MATNR, I.MATNR_T, I.MEINS, I.LGOBE, I.LGORT, '' AS WERKS, '' AS DISPO,
      IFNULL(SUBSTR(REPLACE(CAST(I.VFDAT AS STRING),'-',''),1,8),'') AS VFDAT,
      I.CLABS, IFNULL(I.CINSM,0) AS CINSM, IFNULL(I.UMREZ_BOX,1) AS UMREZ_BOX,
      I.remain_day, I.remain_rate, I.PRDHA_1_T, I.PRDHA_2_T, I.PRDHA_3_T
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB_ALL\` I
    WHERE (I.CLABS > 0 OR I.CINSM > 0)
      AND I.LGORT NOT IN ('1110','2141','2143','2240','2243','3000','3300','9000','9100')
      AND I.MATNR BETWEEN '50000000' AND '69999999'
  `),
  query(`
    SELECT B.MATNR, B.BUDAT,
      SUM((CASE WHEN B.BWART='261' THEN 1 ELSE -1 END) * ABS(IFNULL(B.ERFMG,0)) *
          (CASE WHEN B.ERFME='BOX' AND IFNULL(M.MEINS,'')<>'BOX' THEN IFNULL(M.UMREZ_BOX,1) ELSE 1 END)) AS NET_QTY
    FROM \`harimfood-361004.harim_sap_bi.MM_MB51\` B
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` M ON M.MATNR = B.MATNR
    WHERE B.BUDAT BETWEEN '${FROM}' AND '${TO}' AND B.BWART IN ('261','262')
      AND B.MATNR BETWEEN '50000000' AND '69999999'
    GROUP BY B.MATNR, B.BUDAT
  `),
]);

const netConsumptions = consumptions.map((row) => ({
  MATNR: String(row.MATNR ?? ''),
  BUDAT: typeof row.BUDAT === 'object' && row.BUDAT ? String(row.BUDAT.value) : String(row.BUDAT ?? ''),
  NET_QTY: Number(row.NET_QTY) || 0,
}));

const fromLabel = `${FROM.slice(0, 4)}-${FROM.slice(4, 6)}-${FROM.slice(6, 8)}`;
const toLabel = `${TO.slice(0, 4)}-${TO.slice(4, 6)}-${TO.slice(6, 8)}`;

const before = analyzeSnopData(orders, inventory, [], [], fromLabel, toLabel, '', []);
const after = analyzeSnopData(orders, inventory, [], [], fromLabel, toLabel, '', netConsumptions);

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok) passed++;
  else failed++;
};

console.log(`\n조회 구간 ${fromLabel} ~ ${toLabel} · 납품 ${orders.length.toLocaleString()}행 · 생산투입 ${consumptions.length.toLocaleString()}행\n`);

const beforeMap = new Map(before.integratedArray.map((item) => [item.code, item]));
let decreased = 0;
let withUsage = 0;
let negativeUsage = 0;
let newlyMeasurable = 0;
for (const item of after.integratedArray) {
  const prev = beforeMap.get(item.code);
  if (!prev) continue;
  if (item.inventory.ads90 < prev.inventory.ads90 - 1e-6) decreased++;
  if (item.inventory.usageAds90 > 0) withUsage++;
  if (item.inventory.usageAds90 < 0) negativeUsage++;
  if (prev.inventory.ads90 === 0 && item.inventory.ads90 > 0 && item.inventory.totalStock > 0) newlyMeasurable++;
}

check('ADS 가 줄어든 품목이 없다 (합산은 단조 증가)', decreased === 0, `감소 ${decreased}건`);
check('생산투입 ADS 에 음수가 없다 (262 > 261 구간 clamp)', negativeUsage === 0, `음수 ${negativeUsage}건`);
check('생산투입이 잡힌 품목이 있다', withUsage > 0, `${withUsage.toLocaleString()}개 품목`);
check(
  '판매 0 이라 회전일이 비어 있던 재고 품목이 계산된다',
  newlyMeasurable > 0,
  `${newlyMeasurable.toLocaleString()}개 품목`,
);

const sumOf = (pick) => after.integratedArray.reduce((acc, item) => acc + pick(item.inventory), 0);
const salesAds = sumOf((inv) => inv.salesAds90);
const usageAds = sumOf((inv) => inv.usageAds90);
const totalAds = sumOf((inv) => inv.ads90);
check(
  'ADS = 판매분 + 투입분 항등식',
  Math.abs(totalAds - (salesAds + usageAds)) < 1e-6,
  `판매 ${Math.round(salesAds).toLocaleString()} + 투입 ${Math.round(usageAds).toLocaleString()} = ${Math.round(totalAds).toLocaleString()}/일`,
);

// ⚠️ 이 결과는 unstable_cache 에 gzip 해서 넣는다. 항목 2MB 를 넘으면 저장이 조용히 실패하고
//    매 요청 BigQuery 를 다시 때린다.
const gzBytes = gzipSync(JSON.stringify({ success: true, data: after })).toString('base64').length;
const gzBefore = gzipSync(JSON.stringify({ success: true, data: before })).toString('base64').length;
check(
  'gzip 후 캐시 항목 2MB 제한 안에 든다',
  gzBytes < 2 * 1024 * 1024,
  `${(gzBefore / 1024 / 1024).toFixed(2)}MB → ${(gzBytes / 1024 / 1024).toFixed(2)}MB (${((gzBytes / (2 * 1024 * 1024)) * 100).toFixed(0)}% 사용)`,
);

console.log('\n생산투입이 회전일을 만들어낸 상위 5건:');
after.integratedArray
  .filter((item) => item.inventory.usageAds90 > 0 && item.inventory.totalStock > 0)
  .sort((a, b) => b.inventory.usageAds90 - a.inventory.usageAds90)
  .slice(0, 5)
  .forEach((item) => {
    const turnover = item.inventory.ads90 > 0 ? Math.round(item.inventory.totalStock / item.inventory.ads90) : null;
    console.log(
      `  ${item.code} ${item.name} | 재고 ${Math.round(item.inventory.totalStock).toLocaleString()} | ` +
        `판매ADS ${Math.round(item.inventory.salesAds90).toLocaleString()} + 투입ADS ${Math.round(item.inventory.usageAds90).toLocaleString()} → 회전일 ${turnover}일`,
    );
  });

console.log(`\n${failed === 0 ? '전부 통과' : `${failed}건 실패`} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
