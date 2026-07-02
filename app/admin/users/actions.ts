"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient, getAdminContext } from "@/lib/admin-auth";

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
      admin: null,
    };
  }

  if (!context.isAdmin) {
    return {
      ok: false as const,
      message: context.reason ?? "관리자 권한이 필요합니다.",
      admin: null,
    };
  }

  try {
    return {
      ok: true as const,
      message: "",
      admin: createAdminSupabaseClient(),
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "관리자 클라이언트 생성에 실패했습니다.",
      admin: null,
    };
  }
}

export async function updateUserStatus(
  userId: string,
  status: string,
): Promise<ActionResult> {
  if (!userId || !ALLOWED_STATUSES.has(status)) {
    return { ok: false, message: "잘못된 승인 상태입니다." };
  }

  const guard = await ensureAdmin();
  if (!guard.ok || !guard.admin) {
    return { ok: false, message: guard.message };
  }

  const { data, error } = await guard.admin
    .from("profiles")
    .update({ status })
    .eq("id", userId)
    .select("id");

  if (error) {
    return { ok: false, message: error.message };
  }

  if (!data?.length) {
    const { error: insertError } = await guard.admin
      .from("profiles")
      .insert({ id: userId, status });

    if (insertError) {
      return { ok: false, message: insertError.message };
    }
  }

  revalidatePath("/admin/users");
  return { ok: true, message: "회원 상태를 변경했습니다." };
}

export async function updateUserPassword(
  userId: string,
  password: string,
): Promise<ActionResult> {
  if (!userId || password.length < 8) {
    return { ok: false, message: "비밀번호는 8자 이상으로 입력해주세요." };
  }

  const guard = await ensureAdmin();
  if (!guard.ok || !guard.admin) {
    return { ok: false, message: guard.message };
  }

  const { error } = await guard.admin.auth.admin.updateUserById(userId, {
    password,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "비밀번호를 변경했습니다." };
}
