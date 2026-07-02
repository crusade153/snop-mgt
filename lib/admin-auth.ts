import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export type ProfileRecord = Record<string, unknown> & {
  id?: string;
  status?: string;
};

export type AdminContext = {
  user: User | null;
  profile: ProfileRecord | null;
  isAdmin: boolean;
  isActive: boolean;
  reason?: string;
};

export async function createCookieSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Server components cannot always write refreshed auth cookies.
            }
          });
        },
      },
    },
  );
}

export function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. Supabase Project Settings > API의 service_role 키를 서버 환경변수로 추가해주세요.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function hasAdminProfileFlag(profile: ProfileRecord | null) {
  if (!profile) return false;

  const role = String(profile.role ?? "").toLowerCase();
  const isAdmin = profile.is_admin === true || profile.admin === true;

  return isAdmin || role === "admin" || role === "administrator";
}

export async function getAdminContext(): Promise<AdminContext> {
  const supabase = await createCookieSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      user: null,
      profile: null,
      isAdmin: false,
      isActive: false,
      reason: "로그인이 필요합니다.",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return {
      user,
      profile: null,
      isAdmin: false,
      isActive: false,
      reason: profileError.message,
    };
  }

  const isActive = profile?.status === "active";
  const adminEmails = getAdminEmails();
  const isAdminEmail =
    !!user.email && adminEmails.includes(user.email.toLowerCase());
  const isAdmin = isActive && (isAdminEmail || hasAdminProfileFlag(profile));

  return {
    user,
    profile,
    isAdmin,
    isActive,
    reason: isAdmin
      ? undefined
      : "관리자 권한이 필요합니다. ADMIN_EMAILS 또는 profiles.role/is_admin 설정을 확인해주세요.",
  };
}
