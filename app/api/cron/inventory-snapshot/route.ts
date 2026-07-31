import { captureInventoryDailySnapshot } from '@/lib/inventory-daily-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  try {
    return Response.json({ ok: true, ...(await captureInventoryDailySnapshot()) });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : '스냅샷 적재 실패' }, { status: 500 });
  }
}
