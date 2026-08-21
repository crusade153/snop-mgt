/**
 * 매출 리포트 읽기 전용 검증
 *
 * 이 저장소에는 테스트 프레임워크가 없다. 대신 앱이 실제로 쓰는 순수 함수를 그대로 불러
 * 실데이터(BigQuery, SELECT 전용)로 돌려보고 불변식을 확인한다. **아무 것도 쓰지 않는다.**
 *
 *   node scripts/verify-sales-report.mjs
 *
 * 확인하는 것
 *   1. 기간 프리셋이 손계산과 맞는가
 *   2. 한 방 쿼리가 실제로 돌고 모든 kind 가 돌아오는가
 *   3. 순매출 = 총매출 − 차감 (부호 분해가 어긋나지 않는가)
 *   4. 축을 바꿔도 합계가 같은가 (채널 합 = 브랜드 합 = 영업그룹 합 = 총계)
 *   5. 구성비 합이 100% 인가 (막대 길이의 근거)
 *   6. 월 추이의 합이 총계와 맞는가
 *   7. 전년 동기 구간이 겹칠 때도 집계가 깨지지 않는가
 *   8. 결과 크기가 캐시 항목 2MB 제한 안인가
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(ROOT + '/').href;

// Next 런타임 밖에서 lib/ 모듈을 그대로 불러오기 위한 셰임 두 가지.
//  - '@/...' 별칭: tsconfig paths 가 안 먹으므로 프로젝트 루트로 직접 푼다.
//  - './query' 같은 확장자 없는 상대경로: TS 는 허용하지만 Node ESM 은 아니라 .ts 를 붙여 다시 시도한다.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
      const ROOT = ${JSON.stringify(ROOT_URL)};
      const EXTS = ['.ts', '.tsx', '/index.ts'];
      export async function resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) {
          const base = ROOT + specifier.slice(2);
          for (const ext of [...EXTS, '']) {
            try { return await nextResolve(base + ext, context); } catch {}
          }
        }
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (specifier.startsWith('.')) {
            for (const ext of EXTS) {
              try { return await nextResolve(specifier + ext, context); } catch {}
            }
          }
          throw error;
        }
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

const { BigQuery } = await import('@google-cloud/bigquery');
const { buildSalesReportQuery, buildSalesReportParams, resolvePreset, previousYearRange, PRODUCT_ROW_LIMIT } =
  await import('@/lib/sales-report/query');
const { buildSalesBoard, daySpan, shiftYmYear } = await import('@/lib/sales-report/board');

const BACKSLASH = String.fromCharCode(92);
const bigquery = new BigQuery({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.split(BACKSLASH + 'n').join('\n'),
  },
});

/**
 * BigQuery 오류 객체는 응답 스트림까지 통째로 던져서 콘솔이 수천 줄로 덮인다.
 * 검증 스크립트에서 필요한 것은 메시지 한 줄뿐이라 여기서 잘라낸다.
 */
async function query(sql, params) {
  try {
    const [rows] = await bigquery.query({ query: sql, params });
    return rows;
  } catch (error) {
    console.error(`\n❌ BigQuery 오류: ${error?.message ?? error}\n`);
    process.exit(1);
  }
}

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/** 금액은 부동소수 합이라 원 단위 오차를 허용한다. */
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const eok = (won) => `${(won / 1e8).toFixed(1)}억`;

// ── 1. 기간 프리셋 손계산 ────────────────────────────────────
console.log('\n[1] 기간 프리셋');
{
  const today = new Date('2026-08-21T00:00:00Z');
  const y = resolvePreset('thisYear', today);
  check('올해 = 1/1 ~ 오늘', y.from === '2026-01-01' && y.to === '2026-08-21', `${y.from} ~ ${y.to}`);

  const last = resolvePreset('lastYear', today);
  check('작년 = 전년 1/1 ~ 12/31', last.from === '2025-01-01' && last.to === '2025-12-31', `${last.from} ~ ${last.to}`);

  const m3 = resolvePreset('m3', today);
  check('최근 3개월 = 90일 구간', daySpan(m3.from, m3.to) === 91, `${daySpan(m3.from, m3.to)}일`);

  const prev = previousYearRange('2026-03-01', '2026-03-31');
  check('전년 동기 = 정확히 1년 전', prev.from === '2025-03-01' && prev.to === '2025-03-31', `${prev.from} ~ ${prev.to}`);

  check('ym 12개월 시프트', shiftYmYear('202601', -1) === '202501', shiftYmYear('202601', -1));
}

// ── 2~6. 실데이터 한 방 쿼리 ────────────────────────────────
const params = { from: '2026-01-01', to: '2026-08-21', vtweg: 'ALL', channel: '' };
console.log(`\n[2] 실데이터 조회 (${params.from} ~ ${params.to})`);

const started = Date.now();
const rows = await query(buildSalesReportQuery(), buildSalesReportParams(params));
console.log(`  · ${rows.length.toLocaleString()}행 / ${((Date.now() - started) / 1000).toFixed(1)}초`);

const kinds = new Set(rows.map((r) => r.kind));
for (const k of ['TOTAL_CUR', 'TOTAL_PREV', 'MONTH_CUR', 'MONTH_PREV', 'CHANNEL', 'BRAND', 'MATKL', 'VKGRP', 'CUSTOMER', 'PRODUCT']) {
  check(`kind ${k} 존재`, kinds.has(k));
}

const board = buildSalesBoard(rows, params);

console.log('\n[3] 순매출 부호 분해');
{
  const { net, gross, deduction } = board.kpi;
  check('순매출 = 총매출 − 차감', near(net, gross - deduction), `${eok(net)} = ${eok(gross)} − ${eok(deduction)}`);
  check('차감 > 0 (반품·조정 전표가 실제로 있다)', deduction > 0, eok(deduction));
  check('총매출 ≥ 순매출', gross >= net);
}

console.log('\n[4] 축을 바꿔도 합계가 같은가');
{
  const sum = (list) => list.reduce((acc, r) => acc + r.net, 0);
  const total = board.kpi.net;
  for (const [name, list] of Object.entries(board.ranks)) {
    check(`${name} 합 = 총계`, near(sum(list), total, 2), `${eok(sum(list))} vs ${eok(total)} (${list.length}개)`);
  }
}

console.log('\n[5] 구성비');
{
  for (const [name, list] of Object.entries(board.ranks)) {
    const total = list.reduce((acc, r) => acc + r.share, 0);
    check(`${name} 구성비 합 ≈ 100%`, Math.abs(total - 100) < 0.5, `${total.toFixed(2)}%`);
    check(`${name} 구성비에 음수 없음`, list.every((r) => r.share >= 0));
  }
}

console.log('\n[6] 월 추이');
{
  const sum = board.monthly.reduce((acc, m) => acc + m.net, 0);
  check('월별 합 = 총계', near(sum, board.kpi.net, 2), `${eok(sum)} vs ${eok(board.kpi.net)}`);
  check('당기 구간 밖의 달이 섞이지 않음', board.monthly.every((m) => m.ym >= '202601' && m.ym <= '202608'));
  check('전년 값이 붙었는가', board.monthly.filter((m) => m.prevNet !== null).length === board.monthly.length);
  console.log(
    '  · ' + board.monthly.map((m) => `${m.label} ${eok(m.net)}(전년 ${eok(m.prevNet ?? 0)})`).join(' / '),
  );
}

// ── 6.2 월 시작일이 아닌 기간 (부분월) ───────────────────────
// 이 리포트에서 실제로 틀렸던 지점이다. 넓은 구간에서 한 번에 월별로 묶으면 양끝의 부분월이
// 통째로 딸려 들어와 8/22~ 로 조회해도 8월 막대가 한 달치가 됐다.
// 월 시작일로만 검증하면 이 버그가 통과해 버리므로 일부러 22일부터 조회한다.
console.log('\n[6.2] 부분월 (월 시작일이 아닌 기간)');
{
  const partial = { from: '2025-08-22', to: '2026-08-21', vtweg: 'ALL', channel: '' };
  const partialBoard = buildSalesBoard(
    await query(buildSalesReportQuery(), buildSalesReportParams(partial)),
    partial,
  );

  const monthSum = partialBoard.monthly.reduce((acc, m) => acc + m.net, 0);
  check('부분월 포함 월별 합 = 총계', near(monthSum, partialBoard.kpi.net, 2), `${eok(monthSum)} vs ${eok(partialBoard.kpi.net)}`);

  // 첫 달(2025-08)은 8/22~8/31 열흘치라 이웃한 온전한 달보다 확실히 작아야 한다.
  const first = partialBoard.monthly[0];
  const second = partialBoard.monthly[1];
  check('첫 부분월이 온전한 달보다 작다', first.net < second.net * 0.6, `${first.label} ${eok(first.net)} vs ${second.label} ${eok(second.net)}`);
  check('첫 달이 조회 시작월', first.ym === '202508', first.ym);

  // 전년 값도 같은 부분월이라야 비교가 성립한다.
  check('첫 부분월의 전년도 부분월', first.prevNet !== null && Math.abs(first.prevNet) < Math.abs(second.prevNet ?? 0) * 0.6,
    `전년 ${eok(first.prevNet ?? 0)} vs ${eok(second.prevNet ?? 0)}`);
}

// ── 6.5 제품 표가 자재코드로만 묶였는가 ──────────────────────
// 한 MATNR 에 이름이 여러 개 달려 있어(개명·「[미사용]」 별칭) 이름을 GROUP BY 에 넣으면
// 한 제품이 여러 줄로 쪼개진다. 표의 키가 중복되고 구성비도 조각나므로 여기서 막는다.
console.log('\n[6.5] 제품 표 중복');
{
  const codes = board.products.map((p) => p.matnr);
  check('자재코드가 유일한가', new Set(codes).size === codes.length, `${codes.length}행 / 고유 ${new Set(codes).size}개`);
  check('빈 코드 없음', codes.every((c) => c.length > 0));
  check('대표 이름이 붙었는가', board.products.every((p) => p.name.length > 0));

  const top = board.products[0];
  console.log(`  · 1위: ${top.matnr} ${top.name} — ${eok(top.net)} (${top.share.toFixed(1)}%)`);
}

// ── 7. 구간이 겹치는 장기 조회 ───────────────────────────────
console.log('\n[7] 전년 구간이 당기와 겹치는 경우 (2년치)');
{
  const wide = { from: '2024-06-01', to: '2026-08-21', vtweg: 'ALL', channel: '' };
  const wideRows = await query(buildSalesReportQuery(), buildSalesReportParams(wide));
  const wideBoard = buildSalesBoard(wideRows, wide);
  const monthSum = wideBoard.monthly.reduce((acc, m) => acc + m.net, 0);

  check('겹쳐도 순매출 = 총매출 − 차감', near(wideBoard.kpi.net, wideBoard.kpi.gross - wideBoard.kpi.deduction));
  check('겹쳐도 월별 합 = 총계', near(monthSum, wideBoard.kpi.net, 2), `${eok(monthSum)} vs ${eok(wideBoard.kpi.net)}`);
  check('월 축이 당기 구간만', wideBoard.monthly.every((m) => m.ym >= '202406' && m.ym <= '202608'));
  check('전년 동기 총계가 당기와 다름(겹쳐도 따로 집계됨)', wideBoard.kpi.prevNet !== wideBoard.kpi.net);
}

// ── 8. 캐시 크기 ────────────────────────────────────────────
console.log('\n[8] 캐시 항목 크기');
{
  const bytes = Buffer.byteLength(JSON.stringify(board), 'utf8');
  check('직렬화 결과 < 2MB', bytes < 2 * 1024 * 1024, `${(bytes / 1024).toFixed(0)}KB`);
  check(`제품 행 ≤ 상한 ${PRODUCT_ROW_LIMIT}`, board.products.length <= PRODUCT_ROW_LIMIT, `${board.products.length}행`);
}

console.log(failed === 0 ? '\n✅ 전부 통과\n' : `\n❌ ${failed}건 실패\n`);
process.exit(failed === 0 ? 0 : 1);
