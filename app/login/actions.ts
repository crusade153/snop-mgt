"use server";

import { createAccount, type AccountInput } from "@/lib/account-service";
import { createCookieSupabaseClient, hasAdminSupabaseConfig } from "@/lib/admin-auth";
import {
  GENERIC_LOGIN_ERROR,
  clearFailedAttempts,
  findProfileByLoginId,
  getRemainingLockMinutes,
  normalizeLoginId,
  registerFailedAttempt,
  resolveAuthEmail,
} from "@/lib/pin-auth";

export type SignInResult = {
  ok: boolean;
  message: string;
  redirectTo?: string;
};

const SETUP_REQUIRED =
  "서버 설정이 완료되지 않았습니다. 관리자에게 SUPABASE_SERVICE_ROLE_KEY 등록을 요청해주세요.";

export async function signInWithPin(
  loginIdInput: string,
  pinInput: string,
): Promise<SignInResult> {
  const loginId = normalizeLoginId(loginIdInput ?? "");
  const pin = (pinInput ?? "").trim();

  if (!loginId || !pin) {
    return { ok: false, message: "로그인 ID와 PIN을 모두 입력해주세요." };
  }

  if (!hasAdminSupabaseConfig()) {
    return { ok: false, message: SETUP_REQUIRED };
  }

  let profile;
  try {
    profile = await findProfileByLoginId(loginId);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "로그인 처리 중 오류가 발생했습니다.",
    };
  }

  // 존재하지 않는 ID 도 비밀번호 오류와 같은 문구로 응답한다.
  if (!profile) {
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }

  const remainingLock = getRemainingLockMinutes(profile.locked_until);
  if (remainingLock > 0) {
    return {
      ok: false,
      message: `PIN을 여러 번 잘못 입력해 계정이 잠겼습니다. ${remainingLock}분 후 다시 시도하거나 관리자에게 PIN 재설정을 요청해주세요.`,
    };
  }

  // company_email 로는 폴백하지 않는다. 그 주소는 다른 대시보드의 계정일 수 있다.
  const authEmail = profile.auth_email ?? resolveAuthEmail(loginId);

  const supabase = await createCookieSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: pin,
  });

  if (error) {
    const result = await registerFailedAttempt(
      profile.id,
      profile.failed_attempts ?? 0,
    );

    if (result.locked) {
      return {
        ok: false,
        message: `PIN을 5회 잘못 입력해 계정이 잠겼습니다. 15분 후 다시 시도하거나 관리자에게 PIN 재설정을 요청해주세요.`,
      };
    }

    return {
      ok: false,
      message: `${GENERIC_LOGIN_ERROR} (남은 시도 ${result.remainingAttempts}회)`,
    };
  }

  await clearFailedAttempts(profile.id);

  if (profile.status !== "active") {
    return {
      ok: true,
      redirectTo: "/unauthorized",
      message: "관리자 승인 대기 중인 계정입니다.",
    };
  }

  return { ok: true, redirectTo: "/dashboard", message: "" };
}

export async function requestAccount(
  input: Omit<AccountInput, "role" | "status">,
) {
  if (!hasAdminSupabaseConfig()) {
    return { ok: false, message: SETUP_REQUIRED };
  }

  return createAccount({ ...input, role: "user", status: "pending" });
}
