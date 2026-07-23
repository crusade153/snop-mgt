import { NextResponse } from "next/server";
import { getActiveNotice } from "@/lib/notice";

// 로그인하지 않은 사용자도 호출한다. 응답에는 공지 본문 외 어떤 정보도 담지 않는다.
export const revalidate = 60;

export async function GET() {
  try {
    const notice = await getActiveNotice();

    return NextResponse.json(
      { notice },
      {
        headers: {
          // 로그인 화면 진입마다 DB 를 때리지 않도록 짧게 캐시한다.
          "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return NextResponse.json({ notice: null });
  }
}
