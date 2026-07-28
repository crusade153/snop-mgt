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

/**
 * snop_profiles 에 행이 없는 auth 계정을 되살린다.
 *
 * auth.users 는 5개 대시보드가 공유하므로 "프로필이 없는 계정"은 두 가지다.
 *   1) 구 profiles 에만 남은 우리 회원  → 그 값을 그대로 복원한다.
 *   2) 애초에 다른 대시보드 전용 계정   → 우리 회원이 아니므로 거절한다.
 */
async function repairMissingProfile(userId: string, status: string): Promise<ActionResult> {
  const admin = createAdminSupabaseClient();

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authUser?.user) {
    return { ok: false, message: "인증 계정을 찾을 수 없습니다. 목록을 새로고침해주세요." };
  }

  const metadata = (authUser.user.user_metadata ?? {}) as Record<string, unknown>;
  const { data: legacy } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const authEmail = authUser.user.email ?? "";
  const loginId =
    (legacy?.login_id as string | undefined) ||
    (typeof metadata.login_id === "string" ? metadata.login_id : "") ||
    authEmail.split("@")[0];

  if (!loginId) {
    return {
      ok: false,
      message:
        "이 계정은 이 대시보드의 회원 정보가 없어 승인할 수 없습니다. 다른 대시보드 전용 계정으로 보입니다.",
    };
  }

  const { error: insertError } = await admin.from("snop_profiles").insert({
    id: userId,
    login_id: loginId,
    full_name:
      (legacy?.full_name as string | undefined) ||
      (typeof metadata.full_name === "string" ? metadata.full_name : "") ||
      loginId,
    team:
      (legacy?.team as string | undefined) ||
      (typeof metadata.team === "string" ? metadata.team : "") ||
      "",
    email: (legacy?.email as string | undefined) ?? null,
    company_email: (legacy?.company_email as string | undefined) ?? null,
    auth_email: (legacy?.auth_email as string | undefined) || authEmail,
    role: (legacy?.role as string | undefined) === "admin" ? "admin" : "user",
    status,
    failed_attempts: 0,
    locked_until: null,
  });

  if (insertError) {
    return {
      ok: false,
      message: insertError.message.includes("snop_profiles_login_id_key")
        ? `로그인 ID "${loginId}" 가 이미 다른 회원에게 있습니다. 로그인 ID를 정리한 뒤 다시 시도해주세요.`
        : insertError.message,
    };
  }

  return { ok: true, message: "" };
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

  // .update() 는 대상 행이 없어도 오류를 내지 않는다. 그대로 두면 "승인했습니다"만 뜨고
  // 상태는 그대로인 조용한 실패가 된다. 실제로 바뀐 행을 돌려받아 확인한다.
  const { data: updated, error } = await admin
    .from("snop_profiles")
    .update({ status, failed_attempts: 0, locked_until: null })
    .eq("id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };

  if (!updated || updated.length === 0) {
    // snop_profiles 에 행이 없는 계정이다. auth 정보로 프로필을 만들어 복구한다.
    const repaired = await repairMissingProfile(userId, status);
    if (!repaired.ok) return repaired;
  }

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
  const { data: updated, error } = await admin
    .from("snop_profiles")
    .update({ role })
    .eq("id", userId)
    .select("id");

  if (error) return { ok: false, message: error.message };

  if (!updated || updated.length === 0) {
    return {
      ok: false,
      message: "이 계정은 아직 이 대시보드의 회원이 아닙니다. 먼저 승인해주세요.",
    };
  }

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
    .from("snop_profiles")
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
    .from("snop_profiles")
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

  const { error: profileError } = await admin.from("snop_profiles").delete().eq("id", userId);
  if (profileError) return { ok: false, message: profileError.message };

  const { error } = await admin.auth.admin.deleteUser(userId);

  revalidatePath("/admin/users");

  if (error) {
    // 이 Supabase 프로젝트의 auth.users 는 다른 대시보드와 공유된다.
    // 그쪽에서 참조 중인 계정은 인증 계정을 지울 수 없지만,
    // 이 대시보드의 회원 자격(snop_profiles)은 이미 제거됐으므로 목적은 달성된 것이다.
    return {
      ok: true,
      message: `이 대시보드 회원에서 제거했습니다. 다만 이 계정은 다른 대시보드에서 사용 중이라 인증 계정 자체는 남겨뒀습니다. (${error.message})`,
    };
  }

  return { ok: true, message: "회원을 삭제했습니다." };
}
