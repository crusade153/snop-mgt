import { captureWeeklySnapshot } from '@/lib/weekly-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 주간 재고 스냅샷 적재 (월요일 05:40 KST = 일요일 20:40 UTC).
 *
 * BigQuery 미러가 월요일 04:00 에 갱신되므로 그 뒤에 돌아야 일요일 마감 재고가 잡힌다.
 * `?week=YYYY-MM-DD`(일요일)로 특정 주차를 수동 재적재할 수 있다 —
 * 다만 재고 열은 최초 적재분을 유지하고 출고·생산·매출만 다시 계산한다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const week = new URL(request.url).searchParams.get('week') || undefined;

  try {
    return Response.json({ ok: true, ...(await captureWeeklySnapshot(week)) });
  } catch (error) {
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : '주간 스냅샷 적재 실패' },
      { status: 500 }
    );
  }
}
