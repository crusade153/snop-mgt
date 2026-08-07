"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/lib/admin-auth";
import { rebuildBomMart } from "@/lib/bom/mart";

export type BomRebuildResult = {
  ok: boolean;
  message: string;
};

/**
 * BOM 마트를 전량 재생성한다. 크론이 아니라 관리자가 누를 때만 돈다.
 * BOM 은 거의 변하지 않으므로 이걸로 충분하다.
 */
export async function triggerBomRebuild(
  scope: "PACKAGING" | "RAW_AND_PACKAGING" = "RAW_AND_PACKAGING",
): Promise<BomRebuildResult> {
  const context = await getAdminContext();
  if (!context.user) return { ok: false, message: "로그인이 필요합니다." };
  if (!context.isAdmin) {
    return { ok: false, message: context.reason ?? "관리자 권한이 필요합니다." };
  }

  try {
    const result = await rebuildBomMart({
      scope,
      triggeredBy: context.user.id,
      triggeredByName: String(context.profile?.full_name ?? context.user.email ?? ""),
    });

    revalidatePath("/admin/bom");
    revalidatePath("/materials");

    const notes: string[] = [];
    if (result.suspectLotBasisCount > 0) {
      notes.push(`기준수량 오등록 의심 ${result.suspectLotBasisCount}건`);
    }
    if (result.uomMismatchCount > 0) notes.push(`단위 불일치 ${result.uomMismatchCount}건`);
    if (result.depthCapHits > 0) notes.push(`전개 깊이 상한 도달 ${result.depthCapHits}건`);

    return {
      ok: true,
      message:
        `BOM 마트를 재생성했습니다. ${result.rowCount.toLocaleString()}행 ` +
        `(완제품 ${result.rootCount.toLocaleString()} · 자재 ${result.materialCount.toLocaleString()}, ` +
        `조회 ${(result.bqMs / 1000).toFixed(1)}초)` +
        (notes.length ? ` — ${notes.join(", ")}` : ""),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `재빌드 실패: ${message}` };
  }
}
