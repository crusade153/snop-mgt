/**
 * 주차 계산 — I/O 없는 순수 함수
 *
 * 이 장표의 주차는 **월요일 ~ 일요일**이고, 재고 기준일은 **일요일 마감**이다.
 * 주차를 가리키는 키는 종료 일요일 날짜 하나뿐이다(`weekEnd`).
 *
 * BigQuery 미러는 월요일 새벽 04:00(KST)에 갱신되고 적재 cron 은 05:40 에 돈다.
 * 즉 "월요일 아침에 뜬 재고" = "일요일 마감 재고" 로 본다.
 */

import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';

export interface WeekRange {
  /** 주 시작 월요일 (yyyy-MM-dd) */
  weekStart: string;
  /** 주 종료 일요일 (yyyy-MM-dd). 주차 키다 */
  weekEnd: string;
}

/** 'yyyy-MM-dd' → 'yyyyMMdd'. BigQuery 의 날짜 컬럼이 문자열 8자리라 여기서 맞춘다. */
export function toCompactDate(dateStr: string) {
  return dateStr.replace(/-/g, '');
}

/** Asia/Seoul 기준 오늘 (yyyy-MM-dd). 서버 타임존과 무관하게 한국 날짜를 쓴다. */
export function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** 그 날짜가 속한 주(월~일)의 범위. 일요일은 그 주의 마지막 날로 친다. */
export function weekRangeOf(dateStr: string): WeekRange {
  const date = parseISO(dateStr);
  // getDay(): 0=일 … 6=토. 월요일을 0 으로 놓기 위해 일요일을 6 으로 민다.
  const offsetFromMonday = (date.getDay() + 6) % 7;
  const monday = addDays(date, -offsetFromMonday);
  return {
    weekStart: format(monday, 'yyyy-MM-dd'),
    weekEnd: format(addDays(monday, 6), 'yyyy-MM-dd'),
  };
}

/**
 * 적재 대상 주차 — "직전에 끝난 주".
 *
 * 월요일 05:40 에 도는 cron 이 어제 끝난 주를 적재한다.
 * 수동 재적재 때 아무 날짜나 넣어도 같은 규칙으로 풀리게 하려고 순수 함수로 뺐다.
 */
export function completedWeekOf(dateStr: string): WeekRange {
  const current = weekRangeOf(dateStr);
  // 이번 주 월요일에서 하루 빼면 지난 주 일요일이다.
  return weekRangeOf(format(addDays(parseISO(current.weekStart), -1), 'yyyy-MM-dd'));
}

/** 직전 주차의 종료 일요일. 전주 대비 비교의 상대편이다. */
export function previousWeekEnd(weekEnd: string) {
  return format(addDays(parseISO(weekEnd), -7), 'yyyy-MM-dd');
}

/** '2026-08-02' → '8/2'. 원본 엑셀의 라벨 표기를 그대로 따른다. */
export function shortDateLabel(dateStr: string) {
  const date = parseISO(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** '2026-07-27' ~ '2026-08-02' → '7/27~8/2' */
export function rangeLabel(range: WeekRange) {
  return `${shortDateLabel(range.weekStart)}~${shortDateLabel(range.weekEnd)}`;
}

/** 해당 주차의 비교 기준월 = 주차 종료일이 속한 달의 직전 달 1일 ~ 말일 */
export function previousMonthRange(weekEnd: string): { from: string; to: string } {
  const previousMonth = subMonths(parseISO(weekEnd), 1);
  return {
    from: format(startOfMonth(previousMonth), 'yyyy-MM-dd'),
    to: format(endOfMonth(previousMonth), 'yyyy-MM-dd'),
  };
}

/** 주차 키가 실제로 일요일인지. 손으로 넣은 값을 막는 가드다. */
export function isWeekEnd(dateStr: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && parseISO(dateStr).getDay() === 0;
}

/** 두 주차가 연속인지. 비면 "전주 대비"를 계산하지 않고 비워야 한다. */
export function isConsecutiveWeek(previous: string, current: string) {
  return differenceInCalendarDays(parseISO(current), parseISO(previous)) === 7;
}

/**
 * 이미 적재된 재고를 **마감 재고로 갈아끼워도 되는지** 판정한다.
 *
 * 진행 중인 주차를 「적재」 버튼으로 미리 찍으면 그 재고는 「그 날의 재고」다.
 * 월요일 cron 이 도는 시점에는 그 주차가 이미 마감이라, 순진하게 막으면
 * 재고가 주중 값으로 영영 굳는다. 그래서 교체를 허용하되 **두 조건을 모두** 건다.
 *
 *   1. 기존 값이 주 마감 **전에** 찍혔다 (= 잠정치다)
 *   2. 지금이 주 마감 **직후**(마감 다음 날까지)다
 *
 * ⚠️ **2번이 없으면 소급 불가 원칙이 깨진다.** 조건 1만 보면 몇 주 지난 주차를 다시 돌릴 때
 * 「그때의 재고」가 아니라 「지금 재고」가 그 주차에 들어간다. 실제로 그렇게 만들었다가
 * 8/23 주차(8/19~20 적재)에 8/25 재고가 덮이는 걸 확인하고 이 함수를 뺐다.
 *
 * 월요일 05:40 KST cron 이 정확히 `weekEnd + 1일` 이라 이 창이면 충분하다.
 * BigQuery 미러가 월요일 04:00 에 갱신되므로 그때 읽은 재고가 일요일 마감 재고다.
 */
export function canReplaceMidWeekStock(
  weekEnd: string,
  existingCapturedAtIso: string | null,
  todayKst: string
): boolean {
  if (!existingCapturedAtIso) return false;

  // 주 마감 순간 = 종료 일요일의 KST 자정 = weekEnd 15:00 UTC
  const closedAt = Date.parse(`${weekEnd}T15:00:00Z`);
  const capturedAt = Date.parse(existingCapturedAtIso);
  if (!Number.isFinite(capturedAt) || !Number.isFinite(closedAt)) return false;

  // 1. 기존 값이 주 마감 전에 찍힌 잠정치인가
  if (capturedAt >= closedAt) return false;

  // 2. 지금이 마감 직후(다음 날까지)인가
  const deadline = format(addDays(parseISO(weekEnd), 1), 'yyyy-MM-dd');
  return todayKst <= deadline;
}
