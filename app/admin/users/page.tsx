import { redirect } from "next/navigation";
import {
  createAdminSupabaseClient,
  createCookieSupabaseClient,
  getAdminContext,
  hasAdminSupabaseConfig,
  type ProfileRecord,
} from "@/lib/admin-auth";
import UserManagementClient, { type ManagedUser } from "./user-management-client";

export const dynamic = "force-dynamic";

function readName(profile: ProfileRecord | null, metadata: Record<string, unknown> = {}) {
  const profileName = profile?.full_name ?? profile?.name ?? profile?.display_name;
  const metadataName = metadata.full_name ?? metadata.name;

  return String(profileName ?? metadataName ?? "이름 없음");
}

function readRole(profile: ProfileRecord | null) {
  return String(profile?.role ?? "user");
}

function readEmail(profile: ProfileRecord | null, fallback = "-") {
  return String(profile?.email ?? fallback);
}

function readDate(profile: ProfileRecord | null, key: string) {
  const value = profile?.[key];
  return typeof value === "string" ? value : null;
}

function readIsAdmin(profile: ProfileRecord | null, role: string) {
  return (
    profile?.is_admin === true ||
    profile?.admin === true ||
    role.toLowerCase() === "admin" ||
    role.toLowerCase() === "administrator"
  );
}

function normalizeStatus(profile: ProfileRecord | null) {
  return String(profile?.status ?? "pending");
}

async function getManagedUsersWithServiceRole() {
  const admin = createAdminSupabaseClient();
  const {
    data: { users },
    error: usersError,
  } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (usersError) {
    throw new Error(usersError.message);
  }

  const ids = users.map((user) => user.id);
  const profilesById = new Map<string, ProfileRecord>();

  if (ids.length) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("*")
      .in("id", ids);

    if (profilesError) {
      throw new Error(profilesError.message);
    }

    profiles?.forEach((profile) => {
      if (profile.id) profilesById.set(String(profile.id), profile);
    });
  }

  return users.map((user): ManagedUser => {
    const profile = profilesById.get(user.id) ?? null;
    const role = readRole(profile);

    return {
      id: user.id,
      email: readEmail(profile, user.email ?? "-"),
      name: readName(profile, user.user_metadata ?? {}),
      status: normalizeStatus(profile),
      role,
      isAdmin: readIsAdmin(profile, role),
      createdAt: user.created_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      emailConfirmedAt: user.email_confirmed_at ?? null,
    };
  });
}

async function getManagedUsersFromProfiles() {
  const supabase = await createCookieSupabaseClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (profiles ?? []).map((profile): ManagedUser => {
    const role = readRole(profile);

    return {
      id: String(profile.id),
      email: readEmail(profile),
      name: readName(profile),
      status: normalizeStatus(profile),
      role,
      isAdmin: readIsAdmin(profile, role),
      createdAt: readDate(profile, "created_at"),
      lastSignInAt: null,
      emailConfirmedAt: null,
    };
  });
}

function sortManagedUsers(users: ManagedUser[]) {
  return users.sort((a, b) => {
    const statusOrder = { pending: 0, active: 1, suspended: 2, rejected: 3 };
    const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 9;
    const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 9;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.email.localeCompare(b.email);
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
          이 페이지는 관리자만 접근할 수 있습니다. 현재 기본 관리자는
          <span className="mx-1 font-mono text-neutral-900">yukd2022@harim-foods.com</span>
          입니다.
        </p>
      </div>
    );
  }

  const hasServiceRole = hasAdminSupabaseConfig();
  let users: ManagedUser[] = [];
  let configError: string | undefined;

  try {
    users = sortManagedUsers(
      hasServiceRole
        ? await getManagedUsersWithServiceRole()
        : await getManagedUsersFromProfiles(),
    );
  } catch (error) {
    configError =
      error instanceof Error ? error.message : "회원 목록을 불러오지 못했습니다.";
  }

  return (
    <UserManagementClient
      users={users}
      configError={configError}
      hasServiceRole={hasServiceRole}
    />
  );
}
