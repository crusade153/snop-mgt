"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  createAdminSupabaseClient,
  createCookieSupabaseClient,
  getAdminContext,
  hasAdminSupabaseConfig,
} from "@/lib/admin-auth";

type ActionResult = {
  ok: boolean;
  message: string;
};

const ALLOWED_STATUSES = new Set(["pending", "active", "suspended", "rejected"]);

async function ensureAdmin() {
  const context = await getAdminContext();

  if (!context.user) {
    return {
      ok: false as const,
      message: "로그인이 필요합니다.",
      supabase: null,
    };
  }

  if (!context.isAdmin) {
    return {
      ok: false as const,
      message: context.reason ?? "관리자 권한이 필요합니다.",
      supabase: null,
    };
  }

  return {
    ok: true as const,
    message: "",
    supabase: await createCookieSupabaseClient(),
  };
}

export async function updateUserStatus(
  userId: string,
  status: string,
): Promise<ActionResult> {
  if (!userId || !ALLOWED_STATUSES.has(status)) {
    return { ok: false, message: "잘못된 승인 상태입니다." };
  }

  const guard = await ensureAdmin();
  if (!guard.ok || !guard.supabase) {
    return { ok: false, message: guard.message };
  }

  const { data, error } = await guard.supabase
    .from("profiles")
    .update({ status })
    .eq("id", userId)
    .select("id");

  if (error) {
    return {
      ok: false,
      message: `${error.message} profiles 테이블 RLS가 관리자 업데이트를 막는 경우 Supabase SQL Editor에서 role 정책을 추가해야 합니다.`,
    };
  }

  if (!data?.length) {
    const { error: insertError } = await guard.supabase
      .from("profiles")
      .insert({ id: userId, status, role: "user" });

    if (insertError) {
      return { ok: false, message: insertError.message };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true, message: "회원 상태를 변경했습니다." };
}

export async function updateUserPassword(
  userId: string,
  email: string,
  password: string,
): Promise<ActionResult> {
  if (!userId || !email || email === "-") {
    return { ok: false, message: "비밀번호 재설정에 사용할 이메일이 없습니다." };
  }

  const guard = await ensureAdmin();
  if (!guard.ok || !guard.supabase) {
    return { ok: false, message: guard.message };
  }

  if (hasAdminSupabaseConfig()) {
    if (password.length < 8) {
      return { ok: false, message: "비밀번호는 8자 이상으로 입력해주세요." };
    }

    const admin = createAdminSupabaseClient();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: "비밀번호를 변경했습니다." };
  }

  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL;

  const { error } = await guard.supabase.auth.resetPasswordForEmail(email, {
    redirectTo: origin ? `${origin}/reset-password` : undefined,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    message: "비밀번호 재설정 메일을 발송했습니다. 사용자가 메일 링크에서 새 비밀번호를 설정하면 됩니다.",
  };
}
