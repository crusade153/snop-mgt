import { createAdminSupabaseClient, hasAdminSupabaseConfig } from "@/lib/admin-auth";
import type { NoticeFrequency, NoticeLevel, PublicNotice } from "@/lib/notice-types";

export type {
  NoticeFrequency,
  NoticeLevel,
  NoticeRecord,
  PublicNotice,
} from "@/lib/notice-types";

/**
 * 게시 중이고 기간에 해당하는 공지 1건.
 * 미인증 사용자도 봐야 하므로 service role 로 조회한다.
 */
export async function getActiveNotice(): Promise<PublicNotice | null> {
  if (!hasAdminSupabaseConfig()) return null;

  const admin = createAdminSupabaseClient();

  // 게시 기간은 JS 에서 거른다.
  // PostgREST 에서 .or() 를 두 번 체이닝하면 조건이 의도대로 결합되지 않을 수 있다.
  const { data, error } = await admin
    .from("app_notices")
    .select("id, title, body, level, frequency, starts_at, ends_at, updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error || !data?.length) return null;

  const now = Date.now();
  const current = data.find((row) => {
    const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : null;
    const endsAt = row.ends_at ? new Date(row.ends_at).getTime() : null;

    if (startsAt !== null && !Number.isNaN(startsAt) && startsAt > now) return false;
    if (endsAt !== null && !Number.isNaN(endsAt) && endsAt < now) return false;
    return true;
  });

  if (!current) return null;

  return {
    id: String(current.id),
    title: String(current.title),
    body: String(current.body),
    level: (current.level ?? "warning") as NoticeLevel,
    frequency: (current.frequency ?? "daily") as NoticeFrequency,
    updatedAt: String(current.updated_at),
  };
}
