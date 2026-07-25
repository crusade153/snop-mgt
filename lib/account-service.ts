import { createAdminSupabaseClient } from "@/lib/admin-auth";
import {
  isLoginIdTaken,
  normalizeLoginId,
  resolveAuthEmail,
  validateCompanyEmail,
  validateLoginId,
  validatePin,
} from "@/lib/pin-auth";

export type AccountInput = {
  fullName: string;
  team: string;
  companyEmail: string;
  loginId: string;
  pin: string;
  role?: "admin" | "user";
  status?: "pending" | "active";
};

export type AccountResult = {
  ok: boolean;
  message: string;
  userId?: string;
};

/**
 * 가입 신청(status: pending)과 관리자 직접 생성(status: active)이 같은 경로를 쓴다.
 * auth 계정을 만든 뒤 snop_profiles insert 가 실패하면 auth 계정을 되돌린다.
 */
export async function createAccount(input: AccountInput): Promise<AccountResult> {
  const fullName = input.fullName?.trim() ?? "";
  const team = input.team?.trim() ?? "";
  const role = input.role === "admin" ? "admin" : "user";
  const status = input.status === "active" ? "active" : "pending";

  if (!fullName) return { ok: false, message: "이름을 입력해주세요." };
  if (!team) return { ok: false, message: "팀을 입력해주세요." };

  const emailCheck = validateCompanyEmail(input.companyEmail ?? "");
  if (!emailCheck.ok) return { ok: false, message: emailCheck.message };

  const loginIdCheck = validateLoginId(input.loginId ?? "");
  if (!loginIdCheck.ok) return { ok: false, message: loginIdCheck.message };

  const pinCheck = validatePin(input.pin ?? "");
  if (!pinCheck.ok) return { ok: false, message: pinCheck.message };

  const loginId = loginIdCheck.loginId;
  const companyEmail = emailCheck.email;
  // auth 계정은 내부 전용 이메일로 만든다. (다른 대시보드와 계정 공유 방지)
  const authEmail = resolveAuthEmail(loginId);

  try {
    if (await isLoginIdTaken(loginId)) {
      return { ok: false, message: `이미 사용 중인 로그인 ID입니다: ${loginId}` };
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "로그인 ID 확인에 실패했습니다.",
    };
  }

  const admin = createAdminSupabaseClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password: pinCheck.pin,
    email_confirm: true,
    user_metadata: { full_name: fullName, team, login_id: loginId },
  });

  if (createError || !created?.user) {
    const message = createError?.message ?? "계정 생성에 실패했습니다.";
    return {
      ok: false,
      message: message.toLowerCase().includes("already registered")
        ? `이미 사용 중인 로그인 ID입니다: ${loginId}`
        : message,
    };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("snop_profiles").upsert(
    {
      id: userId,
      login_id: loginId,
      full_name: fullName,
      team,
      company_email: companyEmail,
      auth_email: authEmail,
      email: companyEmail,
      role,
      status,
      failed_attempts: 0,
      locked_until: null,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    // 프로필이 없으면 로그인 자체가 불가능하므로 auth 계정을 남겨두지 않는다.
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, message: profileError.message };
  }

  return {
    ok: true,
    userId,
    message:
      status === "active"
        ? `${fullName} 계정을 생성했습니다. (ID: ${loginId})`
        : "가입 신청이 접수되었습니다. 관리자 승인 후 이용하실 수 있습니다.",
  };
}

export { normalizeLoginId };
