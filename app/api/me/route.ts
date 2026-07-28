import { NextResponse } from "next/server";
import { createCookieSupabaseClient } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * 접속자 표시용 최소 프로필.
 * Presence 채널에 이름/팀을 실어 보내려면 클라이언트가 자기 이름을 알아야 하는데,
 * snop_profiles 는 RLS 때문에 브라우저에서 곧바로 읽기 어렵다.
 */
export async function GET() {
  const supabase = await createCookieSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ signedIn: false }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const { data: profile } = await supabase
    .from("snop_profiles")
    .select("login_id, full_name, team")
    .eq("id", user.id)
    .maybeSingle();

  // 로그인 ID 는 auth 이메일(<login_id>@snop.local)의 앞부분과 같다.
  const fallbackId = (user.email || "").split("@")[0];

  return NextResponse.json(
    {
      signedIn: true,
      userId: user.id,
      loginId: profile?.login_id || fallbackId,
      name: profile?.full_name || profile?.login_id || fallbackId || "사용자",
      team: profile?.team || "",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
