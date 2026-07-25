import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const DEFAULT_ADMIN_EMAILS = ['yukd2022@harim-foods.com'];

function isAdminEmail(email?: string | null) {
  const configuredEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return Boolean(
    email &&
      new Set([...DEFAULT_ADMIN_EMAILS, ...configuredEmails]).has(
        email.toLowerCase(),
      ),
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 1. 현재 세션 확인
  const { data: { session } } = await supabase.auth.getSession();

  // 현재 요청한 경로
  const path = request.nextUrl.pathname;

  // ✅ [허용 경로] 로그인이 필요 없는 페이지들
  // - /login: 로그인 페이지
  // - /unauthorized: 승인 대기 페이지
  // - /auth: 소셜 로그인 등 콜백
  // - /favicon.ico, /_next: 정적 파일 (이미지, 스타일 등)
  // - /api/notice: 로그인 못 한 사용자에게 안내 팝업을 띄우기 위한 공개 API
  const isPublicPath =
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/unauthorized') ||
    path.startsWith('/api/notice') ||
    path.startsWith('/auth') ||
    path.startsWith('/_next') ||
    path.startsWith('/favicon.ico') ||
    path.match(/\.(png|jpg|jpeg|gif|svg)$/); // 이미지 파일 허용

  // 🚀 2. [비로그인 차단] 로그인이 안 된 상태에서 비공개 페이지 접근 시
  if (!session && !isPublicPath) {
    // 무조건 로그인 페이지로 튕겨냅니다.
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 🚀 3. [로그인 완료] 상태에서의 처리
  if (session) {
    // 3-1. 승인 여부 체크 (snop_profiles 테이블)
    const { data: profile } = await supabase
      .from('snop_profiles')
      .select('status')
      .eq('id', session.user.id)
      .single();

    // 승인되지 않은(active가 아닌) 유저가 시스템에 접근하려 할 때
    // (공개 경로는 승인 대기 화면에서 공지를 읽을 수 있도록 그대로 통과시킨다)
    if (profile?.status !== 'active' && !isAdminEmail(session.user.email) && !isPublicPath) {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
    }

    // 3-2. 이미 로그인했는데 다시 로그인 페이지(/login)나 메인(/)으로 오면 -> 대시보드로 보냄
    if (path === '/login' || path === '/') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}

// ⚠️ Matcher를 가장 넓게 설정하여 모든 경로를 감시합니다.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
