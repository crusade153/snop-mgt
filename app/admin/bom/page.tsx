import { redirect } from "next/navigation";
import { getAdminContext, hasAdminSupabaseConfig } from "@/lib/admin-auth";
import { getBomBuildHistory } from "@/lib/bom/mart";
import type { BomBuildRun } from "@/types/material";
import BomAdminClient from "./bom-client";

export const dynamic = "force-dynamic";
// 재빌드는 BigQuery 전개(약 11초) + 5만행 적재라 기본 제한으로는 모자란다.
export const maxDuration = 300;

export default async function AdminBomPage() {
  const context = await getAdminContext();
  if (!context.user) redirect("/login");

  if (!context.isAdmin) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-red-200 bg-white p-8">
        <div className="text-sm font-bold text-red-600">Access denied</div>
        <h1 className="mt-2 text-2xl font-bold text-neutral-950">관리자 권한이 필요합니다.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          BOM 마트 재빌드는 관리자만 실행할 수 있습니다.
        </p>
      </div>
    );
  }

  if (!hasAdminSupabaseConfig()) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-xl font-bold text-neutral-950">SUPABASE_SERVICE_ROLE_KEY가 필요합니다.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          BOM 마트는 서버 전용 service_role로만 적재합니다.
        </p>
      </div>
    );
  }

  let history: BomBuildRun[] = [];
  let configError: string | undefined;
  try {
    history = await getBomBuildHistory(10);
  } catch (error) {
    configError = `${error instanceof Error ? error.message : String(error)} — supabase/bom-mart.sql을 실행했는지 확인해주세요.`;
  }

  return <BomAdminClient history={history} configError={configError} />;
}
