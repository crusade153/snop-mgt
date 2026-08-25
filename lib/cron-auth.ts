/**
 * Vercel Cron 요청 인증 — `/api/cron/*` 공용
 *
 * ⚠️ **「환경변수가 없음」과 「값이 틀림」을 다른 상태코드로 돌려준다.**
 * 둘 다 401 이면 적재가 멈췄을 때 원인을 좁힐 수 없다 — 실제로 이 앱의 cron 이
 * 25일간(2026-07-31 ~ 08-25) 401 만 뱉으며 죽어 있었는데, 응답만 보고는
 * 「설정이 없는 것」인지 「값이 다른 것」인지 가릴 수 없어 진단이 막혔다.
 * `/api/mcp` 가 이미 같은 규약(없으면 503, 틀리면 401)이라 여기도 맞춘다.
 *
 * Vercel 은 `CRON_SECRET` 이 **프로젝트에 정의돼 있을 때만** Authorization 헤더를 붙여 준다.
 * 그래서 503 은 사실상 「Vercel 에 변수가 없거나 이름이 다르다」는 뜻이다.
 *
 * ⚠️ 어느 쪽이든 **시크릿 값 자체는 응답에 절대 넣지 않는다.** 길이·앞자리도 흘리지 말 것 —
 * 이 엔드포인트는 인증 없이 아무나 때려볼 수 있다.
 */
export function denyCronRequest(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      {
        ok: false,
        reason: 'CRON_SECRET_NOT_SET',
        message:
          'CRON_SECRET 환경변수가 이 배포에 없습니다. Vercel 프로젝트 설정에 대문자 CRON_SECRET 을 Production 으로 추가한 뒤 재배포하세요.',
      },
      { status: 503 }
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json(
      {
        ok: false,
        reason: 'CRON_SECRET_MISMATCH',
        message:
          'CRON_SECRET 은 이 배포에 설정돼 있으나 Authorization 헤더의 값이 다릅니다. Vercel 에 저장된 값과 대조하세요.',
      },
      { status: 401 }
    );
  }

  return null;
}
