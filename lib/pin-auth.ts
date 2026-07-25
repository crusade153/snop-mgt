import { createAdminSupabaseClient } from "@/lib/admin-auth";

export const INTERNAL_EMAIL_DOMAIN = "snop.local";
export const COMPANY_EMAIL_DOMAIN = "harim-foods.com";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/** ID 존재 여부를 노출하지 않도록 로그인 실패는 항상 같은 문구를 쓴다. */
export const GENERIC_LOGIN_ERROR = "ID 또는 PIN이 올바르지 않습니다.";

export type PinProfile = {
  id: string;
  login_id: string | null;
  auth_email: string | null;
  company_email: string | null;
  email: string | null;
  full_name: string | null;
  team: string | null;
  role: string | null;
  status: string | null;
  failed_attempts: number | null;
  locked_until: string | null;
};

export function normalizeLoginId(value: string) {
  return value.trim().toLowerCase();
}

export function validateLoginId(value: string) {
  const loginId = normalizeLoginId(value);

  if (loginId.length < 3 || loginId.length > 20) {
    return { ok: false as const, message: "로그인 ID는 3~20자로 입력해주세요." };
  }

  if (!/^[a-z0-9._-]+$/.test(loginId)) {
    return {
      ok: false as const,
      message: "로그인 ID는 영문 소문자, 숫자, . _ - 만 사용할 수 있습니다.",
    };
  }

  return { ok: true as const, loginId };
}

/**
 * PIN 6자리는 조합이 100만 개뿐이라 쉬운 값을 막아야 의미가 있다.
 * 전부 같은 숫자(111111)와 연속 숫자(123456 / 654321)를 거부한다.
 */
export function validatePin(value: string) {
  const pin = value.trim();

  if (!/^\d{6}$/.test(pin)) {
    return { ok: false as const, message: "PIN은 숫자 6자리로 입력해주세요." };
  }

  if (/^(\d)\1{5}$/.test(pin)) {
    return { ok: false as const, message: "같은 숫자만 반복되는 PIN은 사용할 수 없습니다." };
  }

  const digits = pin.split("").map(Number);
  const isAscending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const isDescending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);

  if (isAscending || isDescending) {
    return { ok: false as const, message: "연속된 숫자 PIN은 사용할 수 없습니다." };
  }

  return { ok: true as const, pin };
}

export function validateCompanyEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, message: "이메일 형식이 올바르지 않습니다." };
  }

  return { ok: true as const, email };
}

/**
 * auth 계정 이메일은 항상 내부 전용 주소로 만든다.
 *
 * 이 Supabase 프로젝트의 auth.users 는 다른 대시보드(public.members)와 공유된다.
 * 회사 이메일을 auth 식별자로 쓰면 같은 계정을 공유하게 되어
 * 한쪽에서 PIN 을 바꾸면 다른 쪽 비밀번호까지 바뀌고, 재가입도 이메일 충돌로 막힌다.
 * 회사 이메일은 profiles.company_email 에 표시·연락용으로만 보관한다.
 */
export function resolveAuthEmail(loginId: string) {
  return `${normalizeLoginId(loginId)}@${INTERNAL_EMAIL_DOMAIN}`;
}

export async function findProfileByLoginId(loginId: string) {
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin
    .from("snop_profiles")
    .select(
      "id, login_id, auth_email, company_email, email, full_name, team, role, status, failed_attempts, locked_until",
    )
    .ilike("login_id", normalizeLoginId(loginId))
    .maybeSingle();

  if (error) throw new Error(error.message);

  return (data as PinProfile | null) ?? null;
}

export async function isLoginIdTaken(loginId: string) {
  const admin = createAdminSupabaseClient();

  const { data, error } = await admin
    .from("snop_profiles")
    .select("id")
    .ilike("login_id", normalizeLoginId(loginId))
    .maybeSingle();

  if (error) throw new Error(error.message);

  return Boolean(data);
}

export function getRemainingLockMinutes(lockedUntil: string | null | undefined) {
  if (!lockedUntil) return 0;

  const remainingMs = new Date(lockedUntil).getTime() - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 60000) : 0;
}

/** 실패 횟수를 올리고, 임계치를 넘으면 잠근다. 잠긴 경우 남은 분을 돌려준다. */
export async function registerFailedAttempt(profileId: string, currentAttempts: number) {
  const admin = createAdminSupabaseClient();
  const attempts = (currentAttempts ?? 0) + 1;
  const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

  await admin
    .from("snop_profiles")
    .update({
      failed_attempts: shouldLock ? 0 : attempts,
      locked_until: shouldLock
        ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
        : null,
    })
    .eq("id", profileId);

  return { locked: shouldLock, remainingAttempts: Math.max(MAX_FAILED_ATTEMPTS - attempts, 0) };
}

export async function clearFailedAttempts(profileId: string) {
  const admin = createAdminSupabaseClient();

  await admin
    .from("snop_profiles")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", profileId);
}
