"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabaseClient, getAdminContext } from "@/lib/admin-auth";

export type OwnerActionResult = {
  ok: boolean;
  message: string;
};

export type OwnerPayload = {
  id?: string;
  scopeType: "BRAND" | "CATEGORY" | "FAMILY";
  scopeKey: string;
  ownerId: string;
  role: "PRIMARY" | "BACKUP";
};

const SCOPE_TYPES = new Set(["BRAND", "CATEGORY", "FAMILY"]);
const ROLES = new Set(["PRIMARY", "BACKUP"]);

async function ensureAdmin() {
  const context = await getAdminContext();
  if (!context.user) return { ok: false as const, message: "로그인이 필요합니다." };
  if (!context.isAdmin) {
    return { ok: false as const, message: context.reason ?? "관리자 권한이 필요합니다." };
  }
  return { ok: true as const, message: "" };
}

export async function saveProductOwner(payload: OwnerPayload): Promise<OwnerActionResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const scopeKey = payload.scopeKey?.trim() ?? "";
  if (!SCOPE_TYPES.has(payload.scopeType)) return { ok: false, message: "잘못된 계층 구분입니다." };
  if (!ROLES.has(payload.role)) return { ok: false, message: "잘못된 담당 구분입니다." };
  if (!scopeKey) return { ok: false, message: "담당 범위를 선택해주세요." };
  if (!payload.ownerId) return { ok: false, message: "담당자를 선택해주세요." };

  const admin = createAdminSupabaseClient();

  // 계정이 삭제돼도 이력이 남도록 이름·팀을 함께 박제한다.
  const { data: profile, error: profileError } = await admin
    .from("snop_profiles")
    .select("id, full_name, team")
    .eq("id", payload.ownerId)
    .maybeSingle();

  if (profileError) return { ok: false, message: profileError.message };
  if (!profile) return { ok: false, message: "담당자 계정을 찾을 수 없습니다." };

  const record = {
    scope_type: payload.scopeType,
    scope_key: scopeKey,
    owner_id: payload.ownerId,
    owner_name: String(profile.full_name ?? ""),
    owner_team: profile.team ? String(profile.team) : null,
    role: payload.role,
    updated_at: new Date().toISOString(),
  };

  const { error } = payload.id
    ? await admin.from("snop_product_owners").update(record).eq("id", payload.id)
    : await admin.from("snop_product_owners").insert(record);

  if (error) {
    // 주담당 유일 인덱스(snop_product_owners_one_primary_idx) 위반이 가장 흔하다.
    if (error.code === "23505") {
      return {
        ok: false,
        message: "이 범위에는 이미 주담당이 지정돼 있습니다. 기존 담당을 바꾸거나 백업으로 등록해주세요.",
      };
    }
    return { ok: false, message: error.message };
  }

  revalidatePath("/admin/owners");
  revalidatePath("/materials");
  return { ok: true, message: "담당자를 저장했습니다." };
}

export async function deleteProductOwner(id: string): Promise<OwnerActionResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };
  if (!id) return { ok: false, message: "대상을 찾을 수 없습니다." };

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("snop_product_owners").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/owners");
  revalidatePath("/materials");
  return { ok: true, message: "담당자 지정을 해제했습니다." };
}
