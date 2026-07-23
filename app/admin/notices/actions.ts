"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient, getAdminContext } from "@/lib/admin-auth";
import type { NoticeFrequency, NoticeLevel } from "@/lib/notice";

export type NoticeActionResult = {
  ok: boolean;
  message: string;
};

export type NoticePayload = {
  id?: string;
  title: string;
  body: string;
  level: NoticeLevel;
  frequency: NoticeFrequency;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

const LEVELS = new Set(["info", "warning", "critical"]);
const FREQUENCIES = new Set(["daily", "always"]);

async function ensureAdmin() {
  const context = await getAdminContext();

  if (!context.user) {
    return { ok: false as const, message: "로그인이 필요합니다." };
  }

  if (!context.isAdmin) {
    return { ok: false as const, message: context.reason ?? "관리자 권한이 필요합니다." };
  }

  return { ok: true as const, message: "" };
}

function toIsoOrNull(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function saveNotice(payload: NoticePayload): Promise<NoticeActionResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const title = payload.title?.trim() ?? "";
  const body = payload.body?.trim() ?? "";

  if (!title) return { ok: false, message: "공지 제목을 입력해주세요." };
  if (!body) return { ok: false, message: "공지 내용을 입력해주세요." };
  if (!LEVELS.has(payload.level)) return { ok: false, message: "잘못된 중요도입니다." };
  if (!FREQUENCIES.has(payload.frequency)) return { ok: false, message: "잘못된 노출 주기입니다." };

  const startsAt = toIsoOrNull(payload.startsAt);
  const endsAt = toIsoOrNull(payload.endsAt);

  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
    return { ok: false, message: "게시 종료일이 시작일보다 빠릅니다." };
  }

  const admin = createAdminSupabaseClient();
  const record = {
    title,
    body,
    level: payload.level,
    frequency: payload.frequency,
    is_active: payload.isActive,
    starts_at: startsAt,
    ends_at: endsAt,
    updated_at: new Date().toISOString(),
  };

  const { error } = payload.id
    ? await admin.from("app_notices").update(record).eq("id", payload.id)
    : await admin.from("app_notices").insert(record);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/notices");
  revalidatePath("/api/notice");

  return {
    ok: true,
    message: payload.isActive
      ? "공지를 저장하고 게시했습니다. 로그인 화면에서도 팝업이 표시됩니다."
      : "공지를 저장했습니다. (게시 중지 상태)",
  };
}

export async function toggleNotice(id: string, isActive: boolean): Promise<NoticeActionResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  if (!id) return { ok: false, message: "공지를 찾을 수 없습니다." };

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("app_notices")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/notices");
  revalidatePath("/api/notice");

  return { ok: true, message: isActive ? "공지를 게시했습니다." : "공지 게시를 중지했습니다." };
}

export async function deleteNotice(id: string): Promise<NoticeActionResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  if (!id) return { ok: false, message: "공지를 찾을 수 없습니다." };

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("app_notices").delete().eq("id", id);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/notices");
  revalidatePath("/api/notice");

  return { ok: true, message: "공지를 삭제했습니다." };
}
