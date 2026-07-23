import { redirect } from "next/navigation";
import {
  createAdminSupabaseClient,
  getAdminContext,
  hasAdminSupabaseConfig,
} from "@/lib/admin-auth";
import type { NoticeRecord } from "@/lib/notice";
import NoticeAdminClient from "./notice-client";

export const dynamic = "force-dynamic";

export default async function AdminNoticesPage() {
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
          공지 관리는 관리자만 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  if (!hasAdminSupabaseConfig()) {
    return (
      <div className="mx-auto max-w-2xl rounded border border-amber-200 bg-amber-50 p-8">
        <h1 className="text-xl font-bold text-neutral-950">SUPABASE_SERVICE_ROLE_KEY가 필요합니다.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-700">
          공지 팝업은 로그인하지 않은 사용자에게도 표시되어야 하므로 service role 키로 조회합니다.
          Supabase Dashboard → Project Settings → API → <code>service_role</code> 키를
          <code className="mx-1">.env.local</code>과 Vercel 환경변수에 등록해주세요.
        </p>
      </div>
    );
  }

  const admin = createAdminSupabaseClient();
  let notices: NoticeRecord[] = [];
  let configError: string | undefined;

  const { data, error } = await admin
    .from("app_notices")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    configError = `${error.message} — supabase/notices.sql을 실행했는지 확인해주세요.`;
  } else {
    notices = (data ?? []) as NoticeRecord[];
  }

  return <NoticeAdminClient notices={notices} configError={configError} />;
}
