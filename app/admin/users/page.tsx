import { redirect } from "next/navigation";
import {
  createAdminSupabaseClient,
  getAdminContext,
  hasAdminSupabaseConfig,
  type ProfileRecord,
} from "@/lib/admin-auth";
import UserManagementClient, { type ManagedUser } from "./user-management-client";

export const dynamic = "force-dynamic";

function readString(profile: ProfileRecord | null, key: string, fallback = "") {
  const value = profile?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readDate(profile: ProfileRecord | null, key: string) {
  const value = profile?.[key];
  return typeof value === "string" ? value : null;
}

function isAdminRole(role: string) {
  const normalized = role.toLowerCase();
  return normalized === "admin" || normalized === "administrator";
}

/**
 * auth.users(로그인 이력)와 snop_profiles(이름/팀/로그인 ID)를 합쳐서 보여준다.
 * 계정은 항상 service role 로 생성되므로 두 테이블은 1:1로 대응한다.
 */
async function getManagedUsers(): Promise<ManagedUser[]> {
  const admin = createAdminSupabaseClient();

  const {
    data: { users },
    error: usersError,
  } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (usersError) throw new Error(usersError.message);

  const profilesById = new Map<string, ProfileRecord>();
  const ids = users.map((user) => user.id);

  if (ids.length) {
    const { data: profiles, error: profilesError } = await admin
      .from("snop_profiles")
      .select("*")
      .in("id", ids);

    if (profilesError) throw new Error(profilesError.message);

    profiles?.forEach((profile) => {
      if (profile.id) profilesById.set(String(profile.id), profile);
    });
  }

  return users.map((user): ManagedUser => {
    const profile = profilesById.get(user.id) ?? null;
    const role = readString(profile, "role", "user");
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

    return {
      id: user.id,
      loginId: readString(profile, "login_id", "-"),
      name: readString(profile, "full_name", String(metadata.full_name ?? "이름 없음")),
      team: readString(profile, "team", String(metadata.team ?? "-")),
      email: readString(
        profile,
        "company_email",
        readString(profile, "email", user.email ?? "-"),
      ),
      status: readString(profile, "status", "pending"),
      role,
      isAdmin: isAdminRole(role),
      lockedUntil: readDate(profile, "locked_until"),
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    };
  });
}

function sortManagedUsers(users: ManagedUser[]) {
  const statusOrder: Record<string, number> = {
    pending: 0,
    active: 1,
    suspended: 2,
    rejected: 3,
  };

  return users.sort((a, b) => {
    const aOrder = statusOrder[a.status] ?? 9;
    const bOrder = statusOrder[b.status] ?? 9;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name, "ko-KR");
  });
}

export default async function AdminUsersPage() {
  const context = await getAdminContext();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-red-200 bg-white p-8">
        <div className="text-sm font-bold text-red-600">Access denied</div>
        <h1 className="mt-2 text-2xl font-bold text-neutral-950">관리자 권한이 필요합니다.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          이 페이지는 관리자만 접근할 수 있습니다. 권한이 필요하면 시스템 관리자에게 문의해주세요.
        </p>
      </div>
    );
  }

  if (!hasAdminSupabaseConfig()) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-xl font-bold text-neutral-950">SUPABASE_SERVICE_ROLE_KEY가 필요합니다.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          계정 생성과 PIN 재설정은 service role 권한이 있어야 동작합니다.
          Supabase Dashboard → Project Settings → API → <code>service_role</code> 키를
          <code className="mx-1">.env.local</code>과 Vercel 환경변수에 등록한 뒤 다시 시도해주세요.
        </p>
      </div>
    );
  }

  let users: ManagedUser[] = [];
  let configError: string | undefined;

  try {
    users = sortManagedUsers(await getManagedUsers());
  } catch (error) {
    configError =
      error instanceof Error ? error.message : "회원 목록을 불러오지 못했습니다.";
  }

  return (
    <UserManagementClient
      users={users}
      configError={configError}
      currentUserId={context.user.id}
    />
  );
}
