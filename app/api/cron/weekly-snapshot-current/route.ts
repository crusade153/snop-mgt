import { denyCronRequest } from '@/lib/cron-auth';
import { captureWeeklySnapshot } from '@/lib/weekly-snapshot';
import { seoulToday, weekRangeOf } from '@/lib/weekly/week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 진행 중인 이번 주 잠정 적재 (매일 06:00 KST = 전날 21:00 UTC).
 *
 * `/weekly` 의 「적재」 버튼(주차 미선택)을 매일 아침 대신 눌러 주는 cron 이다.
 * BigQuery 미러가 04:00 에 갱신되므로 그 뒤에 돌아야 어제 전표까지 잡힌다.
 *
 * 진행 중인 주차는 잠정치라 돌 때마다 재고까지 통째로 갱신된다 — 매일 덮어도 소급 불가 원칙과 충돌하지 않는다.
 * 마감 재고 확정은 여전히 월요일 05:40 `/api/cron/weekly-snapshot` 몫이다(`canReplaceMidWeekStock`).
 * ⚠️ 월요일에는 이 cron 이 **새로 시작된 주**를 잡으므로 직전 주차를 건드리지 않는다. 두 cron 을 합치지 말 것.
 */
export async function GET(request: Request) {
  const denied = denyCronRequest(request);
  if (denied) return denied;

  try {
    return Response.json({ ok: true, ...(await captureWeeklySnapshot(weekRangeOf(seoulToday()).weekEnd)) });
  } catch (error) {
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : '주간 잠정 적재 실패' },
      { status: 500 }
    );
  }
}
