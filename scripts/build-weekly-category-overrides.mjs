/**
 * 주간 장표 임시 카테고리 매핑표 생성 — 「S&OP 미매핑 카테고리 구분.xlsx」 → `lib/weekly/category-overrides.ts`
 *
 *   node scripts/build-weekly-category-overrides.mjs "C:/.../S&OP 미매핑 카테고리 구분.xlsx"
 *
 * 사업부가 확인해 준 엑셀(자재코드 · CM · 공장 · 카테고리)을 그대로 상수 파일로 굳힌다.
 * 357행을 손으로 옮기면 오타가 섞이므로, 표를 갱신할 때는 반드시 이 스크립트를 다시 돌릴 것.
 *
 * ⚠️ **CM·공장 열은 파일에 담지 않는다.** 대신 여기서 카테고리 기본값과 어긋나지 않는지 검사하고,
 * 한 줄이라도 어긋나면 파일을 만들지 않고 멈춘다. 엑셀이 CM 을 카테고리와 다르게 주기 시작하면
 * 「카테고리만 덮으면 CM·공장이 따라온다」는 전제가 깨진 것이므로, 파일 형식부터 다시 정해야 한다.
 * (조용히 카테고리만 반영하면 화면의 CM 이 사업부가 적어 준 값과 갈린다.)
 *
 * 아무 것도 읽거나 쓰지 않는다 — 엑셀 1개를 읽어 TS 파일 1개를 쓸 뿐이다(DB·BigQuery 접근 없음).
 */

import { writeFileSync } from 'node:fs';
import xlsx from 'xlsx';

/** 카테고리별 기본 CM·공장. `lib/weekly/classification.ts` 의 표와 같아야 한다. */
const CM_BY_CATEGORY = { 냉동: 'CM1', HMI: 'CM2', 즉석밥: 'CM2', 라면: 'CM3' };
const PLANT_BY_CATEGORY = { 냉동: 'K1', HMI: 'K1', 즉석밥: 'K2', 라면: 'K3' };
/** 파일에 적는 순서 = 화면 표의 행 순서 */
const CATEGORY_ORDER = ['냉동', 'HMI', '즉석밥', '라면'];

const source = process.argv[2];
if (!source) {
  console.error('사용법: node scripts/build-weekly-category-overrides.mjs <엑셀 경로>');
  process.exit(1);
}

const workbook = xlsx.readFile(source);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
// 헤더 행(자재코드 · CM · 공장 · 카테고리)을 건너뛰고 값만 읽는다.
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }).slice(1);

const seen = new Map();
const byCategory = new Map();

rows.forEach((row, index) => {
  const line = index + 2; // 엑셀 행 번호 (1-base + 헤더)
  const code = String(row[0] || '').trim();
  if (!code) return;
  const cm = String(row[1] || '').trim();
  const plant = String(row[2] || '').trim();
  const category = String(row[3] || '').trim();

  const fail = (message) => {
    console.error(`❌ ${line}행 ${code}: ${message}`);
    process.exit(1);
  };

  if (!CM_BY_CATEGORY[category]) fail(`카테고리 축에 없는 값 「${category}」`);
  if (!/^5\d{7}$/.test(code)) fail('완제품·상품 대역(5xxxxxxx)이 아니다');
  if (CM_BY_CATEGORY[category] !== cm) {
    fail(`CM 이 카테고리 기본값과 다르다 (엑셀 ${cm} ≠ ${category} 기본 ${CM_BY_CATEGORY[category]}) — 파일 형식부터 다시 정할 것`);
  }
  if (PLANT_BY_CATEGORY[category] !== plant) {
    fail(`공장이 카테고리 기본값과 다르다 (엑셀 ${plant} ≠ ${category} 기본 ${PLANT_BY_CATEGORY[category]})`);
  }
  if (seen.has(code) && seen.get(code) !== category) {
    fail(`같은 자재코드에 카테고리가 둘이다 (${seen.get(code)} / ${category})`);
  }
  if (seen.has(code)) return; // 완전히 같은 중복 행은 조용히 접는다

  seen.set(code, category);
  if (!byCategory.has(category)) byCategory.set(category, []);
  byCategory.get(category).push(code);
});

const present = CATEGORY_ORDER.filter((category) => byCategory.has(category));
const body = present
  .map((category) => {
    const codes = byCategory.get(category).sort();
    const lines = codes.map((code) => `  '${code}': '${category}',`).join('\n');
    return `  // ${category} — ${codes.length}품목\n${lines}`;
  })
  .join('\n\n');

const output = `/**
 * 미매핑 SKU 임시 카테고리 매핑 — **기준정보(DISPO) 정비 전까지만 쓰는 한시 표**
 *
 * ⚠️ **손으로 고치지 말 것.** \`scripts/build-weekly-category-overrides.mjs\` 가 사업부 엑셀
 * (「S&OP 미매핑 카테고리 구분.xlsx」: 자재코드 · CM · 공장 · 카테고리)에서 생성한다.
 * 표를 갱신할 때는 엑셀을 받아 그 스크립트를 다시 돌린다.
 *
 * 생산 플랜트(1021·1022·1023) 자재마스터에 DISPO 가 없는 SKU 는 카테고리 축에 담기지 못해
 * 주간 장표에서 통째로 「기타 / 미분류」로 떨어진다. 그중 사업부가 직접 확인해 자리를 지정해 준 목록이 이 표다
 * (실측 2026-09-06 주차: 미매핑 4.71억 → 0.61억, ${seen.size}품목 · 4.10억 커버).
 *
 * ⚠️ **이것은 폴백이지 우선순위가 아니다.** \`categoryOfMaterial\` 은 DISPO 로 분류가 되면
 * 이 표를 아예 보지 않는다. 기준정보가 정비돼 DISPO 가 붙는 순간 그쪽이 자동으로 이기고
 * 이 표는 조용히 무효가 된다 — 그래야 임시 매핑이 정식 기준정보를 가리지 않는다.
 *
 * ⚠️ **CM·공장은 여기 담지 않는다.** 엑셀의 CM·공장이 카테고리 기본값
 * (냉동=CM1/K1, HMI=CM2/K1, 즉석밥=CM2/K2, 라면=CM3/K3)과 전 행 일치하는 것을 생성 시점에 검사하므로,
 * 카테고리 하나만 덮으면 CM·공장은 \`cmOfCategory\`·\`plantOfCategory\` 로 같은 값이 나온다.
 * 여기에 CM 을 따로 적으면 두 곳이 갈린다 — \`verify:weekly\` [2]가 이 일치를 지킨다.
 *
 * ⚠️ 이 파일은 **정비가 끝나면 지우는 것이 목표**다. 새 SKU 를 넣기 전에
 * 자재마스터에 DISPO 를 붙일 수 있는지 먼저 확인할 것.
 */

import type { WeeklyCategory } from '@/lib/weekly/classification';

/** 자재코드 → 카테고리. 사업부 확인을 거친 값만 담는다. */
export const MATERIAL_CATEGORY_OVERRIDES: Record<string, WeeklyCategory> = {
${body}
};

/** 임시 매핑에 등록된 SKU 인지. 화면·엑셀에서 「임시매핑」으로 표시할 때 쓴다. */
export function isOverriddenMaterial(materialCode?: string | null) {
  return Boolean(MATERIAL_CATEGORY_OVERRIDES[String(materialCode || '').trim()]);
}
`;

writeFileSync('lib/weekly/category-overrides.ts', output, 'utf8');
console.log(`✅ lib/weekly/category-overrides.ts 생성 — ${seen.size}품목`);
present.forEach((category) => console.log(`   ${category} ${byCategory.get(category).length}품목`));
console.log('\n다음: npx tsc --noEmit && npm run verify:weekly');
