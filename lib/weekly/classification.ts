/**
 * 주간 장표의 분류 축 — I/O 없는 순수 함수
 *
 * 원본 수기 엑셀은 CM × 공장 × 카테고리로 재고를 찢는다.
 * 그런데 SAP 에는 아직 CM 기준정보가 없다(제품계층 4레벨로 올라올 예정).
 * 그래서 **당분간 DISPO(MRP 관리자) 코드로 카테고리·공장을 판정**하고,
 * CM 은 `snop_cm_mapping` 테이블을 우선 보되 없으면 카테고리에서 기본값을 끌어온다.
 *
 * ⚠️ 여기 매핑은 조직표가 아니라 **이 장표의 집계 기준**이다.
 *   - M13(전처리)은 조직상 K1 냉동팀_전처리지만 이 장표에서는 라면(K3)으로 센다.
 *   - M31(FD 동결건조)은 카테고리 축이 4개뿐이라 K2 즉석밥 행에 함께 잡힌다.
 *   - **A 접두 DISPO 는 뒤 두 자리가 같은 M 과 같은 분류다**(A08 = M08 = 소스 → HMI).
 *   - **H 접두(H01)는 상품**이라 CM1~CM3 어디에도 넣지 않고 `상품` 행으로 따로 합산한다.
 * 전부 확인을 거친 결정이므로 조직표를 근거로 되돌리지 말 것.
 * 적재는 SKU 단위로 하고 `dispo` 원본값을 그대로 보관하므로,
 * 카테고리 축을 늘리고 싶으면 이 파일만 고치면 과거 주차까지 다시 접힌다.
 */

export type WeeklyCategory = '냉동' | 'HMI' | '즉석밥' | '라면' | '상품' | '기타';
export type WeeklyPlant = 'K1' | 'K2' | 'K3' | '기타';
/** 상품(H01)은 생산 CM 축 밖이라 `상품` 을 CM 값으로 함께 쓴다. */
export type WeeklyCm = 'CM1' | 'CM2' | 'CM3' | '상품' | '미분류';

/** 창고 그룹. 원본 엑셀에는 없던 축이고, 기타창고를 드러내려고 새로 만들었다. */
export type WeeklyStorageScope = 'PLANT' | 'LOGISTICS' | 'OTHER';

export const WEEKLY_CATEGORY_ORDER: WeeklyCategory[] = ['냉동', 'HMI', '즉석밥', '라면', '상품', '기타'];
export const WEEKLY_CM_ORDER: WeeklyCm[] = ['CM1', 'CM2', 'CM3', '상품', '미분류'];

/**
 * 화면 기본 스코프 = `/stock` 의 「통합 재고」와 같은 정의(플랜트 + 물류).
 *
 * ⚠️ 기타 창고를 기본에 넣으면 `/stock` 의 재고금액과 어긋난다. 켜서 보는 옵션으로만 둘 것.
 */
export const WEEKLY_DEFAULT_SCOPES: WeeklyStorageScope[] = ['PLANT', 'LOGISTICS'];

export const WEEKLY_STORAGE_SCOPE_LABELS: Record<WeeklyStorageScope, string> = {
  PLANT: '플랜트 재고',
  LOGISTICS: '물류 재고',
  OTHER: '기타 창고',
};

/**
 * 지금까지 재고 조회에서 통째로 제외돼 있던 저장위치 = `기타 창고` 그룹.
 *
 * 액션마다 제외 목록이 4개/5개/9개로 갈려 있었다. 이 장표에서는 이 목록을 버리는 대신
 * `OTHER`(기타 창고) 그룹으로 묶어 **필터로 켜고 끌 수 있게** 한다.
 *
 * ⚠️ **3000(물류창고)은 일부러 뺐다.** FBH 물류센터 재고의 SAP 측 미러이기 때문이다.
 * 실측: 3000 에 재고가 있는 445품목 중 381품목이 FBH 에도 있고 수량도 거의 같다(32품목은 완전 일치).
 * 여기에 넣으면 물류 재고를 두 번 센다. FBH 는 이미 `LOGISTICS` 그룹으로 따로 잡힌다.
 *
 * ⚠️ 이 그룹을 포함한 3그룹 합계는 이 주간 장표 안에서만 쓴다.
 * `/stock`·MCP·아침브리핑의 기존 「통합 재고」 정의는 건드리지 않는다 — 기존 숫자를 흔들지 않기 위한 것이다.
 */
export const OTHER_STORAGE_LOCATIONS = [
  '1110', // (실측 재고 없음)
  '2141', // 매출이월창고
  '2143', // 1공장 매출이관창고
  '2240', // 3공장 제품이월창고
  '2243', // 3공장 매출이관창고
  '3300', // (실측 재고 없음)
  '9000', // 오드그로서 창고
  '9100', // 미식마켓 창고
] as const;

/** FBH 물류센터 재고와 중복되므로 어느 그룹에도 넣지 않고 버리는 저장위치. */
export const FBH_MIRROR_STORAGE_LOCATIONS = ['3000'] as const;

const OTHER_STORAGE_SET = new Set<string>(OTHER_STORAGE_LOCATIONS);
const FBH_MIRROR_SET = new Set<string>(FBH_MIRROR_STORAGE_LOCATIONS);

/** 물류 재고와 이중계상되는 저장위치인지. true 면 적재 대상에서 통째로 뺀다. */
export function isFbhMirrorLocation(lgort?: string | null) {
  return FBH_MIRROR_SET.has(String(lgort || '').trim());
}

/**
 * DISPO → 카테고리. **접두 문자를 떼고 뒤 두 자리 숫자로만** 비교한다.
 *
 * 생산 라인 코드는 M(생산) 과 A(자소용) 두 계열로 들어오는데 뒤 두 자리의 뜻은 같다 —
 * A08 은 M08(소스)과 같은 라인이라 HMI 로 센다. 실측 미매핑 금액의 대부분이 A 계열이었다.
 * H 계열(H01 상품)만 이 표를 타지 않고 `상품` 카테고리로 빠진다.
 */
const CATEGORY_BY_DISPO: Record<string, WeeklyCategory> = {
  '01': '냉동',
  '02': '냉동',
  '03': '냉동',
  '04': '냉동',
  '05': '냉동',
  '10': '냉동',
  '06': 'HMI',
  '07': 'HMI',
  '08': 'HMI',
  '09': 'HMI',
  '30': '즉석밥',
  '31': '즉석밥',
  '32': '즉석밥',
  '11': '라면',
  '12': '라면',
  '13': '라면',
  '14': '라면',
  '15': '라면',
  '16': '라면',
  '17': '라면',
  '19': '라면',
};

const PLANT_BY_CATEGORY: Record<WeeklyCategory, WeeklyPlant> = {
  냉동: 'K1',
  HMI: 'K1',
  즉석밥: 'K2',
  라면: 'K3',
  // 상품은 사서 파는 물건이라 생산 공장이 없다. 공장 열에는 '기타'로 두고 CM·카테고리 열이 성격을 말한다.
  상품: '기타',
  기타: '기타',
};

/**
 * CM 기준정보가 아직 없을 때 쓰는 기본값.
 * `snop_cm_mapping` 에 SKU 가 등록돼 있으면 그쪽이 항상 우선한다.
 */
const CM_BY_CATEGORY: Record<WeeklyCategory, WeeklyCm> = {
  냉동: 'CM1',
  HMI: 'CM2',
  즉석밥: 'CM2',
  라면: 'CM3',
  // 상품은 CM1~CM3 어디에도 섞지 않는다. 생산 CM 합계를 흐리지 않으려고 별도 행으로 뽑는다.
  상품: '상품',
  기타: '미분류',
};

/** 라인 번호가 같으면 같은 분류로 보는 접두 문자. 빈 접두(숫자만)도 포함한다. */
const LINE_DISPO_PREFIXES = new Set(['', 'M', 'A']);

/** 상품 접두. 생산 라인이 아니므로 라인 번호 표를 타지 않는다. */
const MERCHANDISE_DISPO_PREFIXES = new Set(['H']);

/** 'M07' / 'a07' / '7' 을 전부 `{ prefix, line }` 로 쪼갠다. 숫자가 없으면 line 이 빈 문자열이다. */
function parseDispo(dispo?: string | null): { prefix: string; line: string } {
  const text = String(dispo || '').trim().toUpperCase();
  const matched = text.match(/^([A-Z]*)(\d{1,2})$/);
  if (!matched) return { prefix: text, line: '' };
  return { prefix: matched[1], line: matched[2].padStart(2, '0') };
}

export function categoryOfDispo(dispo?: string | null): WeeklyCategory {
  const { prefix, line } = parseDispo(dispo);
  if (!line) return '기타';
  if (MERCHANDISE_DISPO_PREFIXES.has(prefix)) return '상품';
  // 모르는 접두(다른 조직 코드)는 라인 번호가 같아도 섞지 않는다. 기타로 남겨 금액으로 드러낸다.
  if (!LINE_DISPO_PREFIXES.has(prefix)) return '기타';
  return CATEGORY_BY_DISPO[line] || '기타';
}

export function plantOfCategory(category: WeeklyCategory): WeeklyPlant {
  return PLANT_BY_CATEGORY[category];
}

export function plantOfDispo(dispo?: string | null): WeeklyPlant {
  return plantOfCategory(categoryOfDispo(dispo));
}

/** CM 매핑에 없는 SKU 는 카테고리 기본값으로 떨어뜨린다. 상품은 항상 `상품` 이다. */
export function cmOfCategory(category: WeeklyCategory): WeeklyCm {
  return CM_BY_CATEGORY[category];
}

/**
 * 저장위치 → 창고 그룹.
 * FBH 물류센터 재고는 저장위치가 없으므로 호출부에서 'LOGISTICS' 를 직접 넘긴다.
 */
export function storageScopeOfLgort(lgort?: string | null): WeeklyStorageScope {
  return OTHER_STORAGE_SET.has(String(lgort || '').trim()) ? 'OTHER' : 'PLANT';
}

/** 원본 엑셀의 행 순서(CM1 냉동 → CM2 HMI → CM2 즉석밥 → CM3 라면)를 재현하기 위한 정렬 가중치 */
export function rowSortWeight(cm: WeeklyCm, category: WeeklyCategory) {
  const cmIndex = WEEKLY_CM_ORDER.indexOf(cm);
  const categoryIndex = WEEKLY_CATEGORY_ORDER.indexOf(category);
  return (cmIndex < 0 ? WEEKLY_CM_ORDER.length : cmIndex) * 100 +
    (categoryIndex < 0 ? WEEKLY_CATEGORY_ORDER.length : categoryIndex);
}
