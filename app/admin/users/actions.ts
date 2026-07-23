"use server";

import { revalidatePath } from "next/cache";
import { createAccount, type AccountInput } from "@/lib/account-service";
import {
  createAdminSupabaseClient,
  getAdminContext,
  hasAdminSupabaseConfig,
} from "@/lib/admin-auth";
import { validatePin } from "@/lib/pin-auth";

type ActionResult = {
  ok: boolean;
  message: string;
};

const ALLOWED_STATUSES = new Set(["pending", "active", "suspended", "rejected"]);
const ALLOWED_ROLES = new Set(["admin", "user"]);

async function ensureAdmin() {
  const context = await getAdminContext();

  if (!context.user) {
    return { ok: false as const, message: "로그인이 필요합니다.", userId: null };
  }

  if (!context.isAdmin) {
    return {
      ok: false as const,
      message: context.reason ?? "관리자 권한이 필요합니다.",
      userId: null,
    };
  }

  if (!hasAdminSupabaseConfig()) {
    return {
      ok: false as const,
      message:
        "SUPABASE_SERVICE_ROLE_KEY가 없어 회원 관리를 할 수 없습니다. Supabase Dashboard → Project Settings → API 에서 service_role 키를 발급받아 등록해주세요.",
      userId: null,
    };
  }

  return { ok: true as const, message: "", userId: context.user.id };
}

export async function updateUserStatus(
  userId: string,
  status: string,
): Promise<ActionResult> {
  if (!userId || !ALLOWED_STATUSES.has(status)) {
    return { ok: false, message: "잘못된 승인 상태입니다." };
  }

  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  if (userId === guard.userId && status !== "active") {
    return { ok: false, message: "본인 계정은 중지할 수 없습니다." };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("profiles")
    .update({ status, failed_attempts: 0, locked_until: null })
    .eq("id", userId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");

  const messages: Record<string, string> = {
    active: "승인했습니다. 이제 로그인할 수 있으며 '가입 회원' 탭에서 확인됩니다.",
    suspended: "로그인을 중지했습니다. '가입 회원' 탭에서 언제든 재활성화할 수 있습니다.",
    rejected: "가입을 반려했습니다. '가입 회원' 탭에서 다시 승인할 수 있습니다.",
    pending: "승인 대기 상태로 되돌렸습니다.",
  };

  return { ok: true, message: messages[status] ?? "회원 상태를 변경했습니다." };
}

export async function updateUserRole(
  userId: string,
  role: string,
): Promise<ActionResult> {
  if (!userId || !ALLOWED_ROLES.has(role)) {
    return { ok: false, message: "잘못된 역할입니다." };
  }

  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  // 마지막 관리자가 스스로를 강등하면 아무도 회원관리를 못 하게 된다.
  if (userId === guard.userId && role !== "admin") {
    return { ok: false, message: "본인의 관리자 권한은 해제할 수 없습니다." };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: role === "admin" ? "관리자로 지정했습니다." : "일반 사용자로 변경했습니다.",
  };
}

export async function resetUserPin(
  userId: string,
  newPin: string,
): Promise<ActionResult> {
  if (!userId) return { ok: false, message: "대상 회원을 찾을 수 없습니다." };

  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const pinCheck = validatePin(newPin ?? "");
  if (!pinCheck.ok) return { ok: false, message: pinCheck.message };

  const admin = createAdminSupabaseClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: pinCheck.pin,
  });

  if (error) return { ok: false, message: error.message };

  // PIN 재설정은 잠금 해제도 겸한다.
  await admin
    .from("profiles")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", userId);

  revalidatePath("/admin/users");
  return { ok: true, message: "PIN을 재설정했습니다. 본인에게 새 PIN을 알려주세요." };
}

export async function unlockUser(userId: string): Promise<ActionResult> {
  if (!userId) return { ok: false, message: "대상 회원을 찾을 수 없습니다." };

  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("profiles")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", userId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/users");
  return { ok: true, message: "계정 잠금을 해제했습니다." };
}

export async function createUserAccount(
  input: AccountInput,
): Promise<ActionResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  // 관리자가 만드는 계정은 승인 절차 없이 바로 사용 가능하다. (임원 등)
  const result = await createAccount({
    ...input,
    role: input.role === "admin" ? "admin" : "user",
    status: "active",
  });

  if (result.ok) revalidatePath("/admin/users");

  return { ok: result.ok, message: result.message };
}

export async function deleteUserAccount(userId: string): Promise<ActionResult> {
  if (!userId) return { ok: false, message: "대상 회원을 찾을 수 없습니다." };

  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  if (userId === guard.userId) {
    return { ok: false, message: "본인 계정은 삭제할 수 없습니다." };
  }

  const admin = createAdminSupabaseClient();

  const { error: profileError } = await admin.from("profiles").delete().eq("id", userId);
  if (profileError) return { ok: false, message: profileError.message };

  const { error } = await admin.auth.admin.deleteUser(userId);

  revalidatePath("/admin/users");

  if (error) {
    // 이 Supabase 프로젝트의 auth.users 는 다른 대시보드와 공유된다.
    // 그쪽에서 참조 중인 계정은 인증 계정을 지울 수 없지만,
    // 이 대시보드의 회원 자격(profiles)은 이미 제거됐으므로 목적은 달성된 것이다.
    return {
      ok: true,
      message: `이 대시보드 회원에서 제거했습니다. 다만 이 계정은 다른 대시보드에서 사용 중이라 인증 계정 자체는 남겨뒀습니다. (${error.message})`,
    };
  }

  return { ok: true, message: "회원을 삭제했습니다." };
}
