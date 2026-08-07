import { redirect } from "next/navigation";
import { createAdminSupabaseClient, getAdminContext, hasAdminSupabaseConfig } from "@/lib/admin-auth";
import { loadProductHierarchy, loadProductOwners, type HierarchyNode } from "@/lib/material/ownership";
import type { ProductOwner } from "@/types/material";
import OwnersAdminClient from "./owners-client";

export const dynamic = "force-dynamic";

export type ProfileOption = { id: string; name: string; team: string | null };

export default async function AdminOwnersPage() {
  const context = await getAdminContext();
  if (!context.user) redirect("/login");

  if (!context.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-red-200 bg-white p-8">
        <div className="text-sm font-bold text-red-600">Access denied</div>
        <h1 className="mt-2 text-2xl font-bold text-neutral-950">관리자 권한이 필요합니다.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          담당자 매핑은 관리자만 변경할 수 있습니다.
        </p>
      </div>
    );
  }

  if (!hasAdminSupabaseConfig()) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-xl font-bold text-neutral-950">SUPABASE_SERVICE_ROLE_KEY가 필요합니다.</h1>
      </div>
    );
  }

  const admin = createAdminSupabaseClient();
  let owners: ProductOwner[] = [];
  let hierarchy: HierarchyNode[] = [];
  let profiles: ProfileOption[] = [];
  let configError: string | undefined;

  try {
    [owners, hierarchy] = await Promise.all([loadProductOwners(), loadProductHierarchy()]);
    const { data } = await admin
      .from("snop_profiles")
      .select("id, full_name, team")
      .eq("status", "active")
      .order("full_name");
    profiles = (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.full_name ?? ""),
      team: row.team ? String(row.team) : null,
    }));
  } catch (error) {
    configError = `${error instanceof Error ? error.message : String(error)} — supabase/material-ownership.sql을 실행했는지 확인해주세요.`;
  }

  return (
    <OwnersAdminClient
      owners={owners}
      hierarchy={hierarchy}
      profiles={profiles}
      configError={configError}
    />
  );
}
