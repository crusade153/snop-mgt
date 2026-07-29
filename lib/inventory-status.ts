/**
 * 재고 배치의 유통기한 상태 판정 규칙 (단일 출처)
 *
 * 화면(재고현황 탭)과 MCP 툴이 같은 기준을 쓰도록 여기 한 곳에만 정의한다.
 * 기준이 화면마다 다르면 "임박 재고가 왜 다르냐"는 질문이 반드시 나온다.
 */

export type InventoryRiskStatus =
  | 'disposed'   // 폐기 대상: 잔여 0일 이하
  | 'imminent'   // 임박: 1~30일
  | 'critical'   // 긴급: 31~60일
  | 'healthy'    // 양호: 61일 이상
  | 'no_expiry'; // 기한없음: 유통기한 정보 없음

export const INVENTORY_STATUS_LABELS: Record<InventoryRiskStatus, string> = {
  disposed: '폐기',
  imminent: '임박',
  critical: '긴급',
  healthy: '양호',
  no_expiry: '기한없음',
};

/** 임박 판정 상한(일) */
export const IMMINENT_MAX_DAYS = 30;
/** 긴급 판정 상한(일) */
export const CRITICAL_MAX_DAYS = 60;

/** 모델·사람에게 그대로 보여줄 판정 기준 설명 */
export const INVENTORY_STATUS_RULE_TEXT =
  '폐기=잔여 0일 이하, 임박=1~30일, 긴급=31~60일, 양호=61일 이상, 기한없음=유통기한 미설정';

export function isNoExpiry(expirationDate?: string | null): boolean {
  const value = String(expirationDate ?? '').trim();
  return !value || value === '-' || value === '기한없음' || value.startsWith('0000');
}

/**
 * 배치 하나의 상태를 판정한다.
 * @param expirationDate yyyyMMdd 문자열 또는 '기한없음'
 * @param remainDays 잔여 일수
 */
export function classifyInventoryStatus(
  expirationDate: string | null | undefined,
  remainDays: number,
): InventoryRiskStatus {
  if (isNoExpiry(expirationDate)) return 'no_expiry';
  if (remainDays <= 0) return 'disposed';
  if (remainDays <= IMMINENT_MAX_DAYS) return 'imminent';
  if (remainDays <= CRITICAL_MAX_DAYS) return 'critical';
  return 'healthy';
}
