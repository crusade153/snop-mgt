# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

하림산업 S&OP 대시보드. SAP 데이터를 BigQuery 미러에서 읽어 판매·재고·생산·자재를 한 화면에서 보는 Next.js 앱이다.
코드 주석과 UI 문구는 전부 한국어이며, 새 코드도 같은 톤을 유지한다.

## 명령어

```bash
npm run dev        # 개발 서버 (3000)
npm run build      # 프로덕션 빌드 (타입 오류가 여기서 잡힌다)
npm run lint       # eslint (flat config, next core-web-vitals + typescript)
npx tsc --noEmit   # 타입만 빠르게 확인
npm run verify:bom # BOM 마트·자재 귀속 실데이터 검증 (아래 참고)
```

**테스트 프레임워크가 없다.** 유일한 자동 검증은 `scripts/verify-bom-mart.mjs` 이며,
`.env.local` 을 직접 파싱해 실제 BigQuery 를 읽고(SELECT 전용) 불변식을 확인한다 —
지분합 = 1, 배분금액 합 = 실재고금액, 캐시 gzip 후 2MB 미만, 손계산(N개입 박스 = 1/N) 대조 등.
실패하면 exit 1. 그래서 **계산 로직은 I/O 없는 순수 함수로 `lib/` 에 두고, `'use server'` 파일에는 실행·캐시만 둔다** —
`'use server'` 모듈은 Next 런타임 밖에서 로드되지 않아 이 스크립트로 검증할 수 없기 때문이다.
자재/BOM 계산을 건드렸으면 `npm run verify:bom` 을 돌려야 한다.

## 데이터 소스 4개

| 소스 | 용도 | 접근 |
| --- | --- | --- |
| BigQuery `harimfood-361004.harim_sap_bi` / `harim_sap_bi_user` | SAP 미러. **읽기 전용** | `lib/bigquery.ts` (싱글톤, 없으면 import 시점에 throw) |
| Supabase (앱 소유 프로젝트) | 인증·프로필·즐겨찾기·공지·담당자매핑·BOM 마트·재고 스냅샷 | `lib/admin-auth.ts` |
| Supabase (원가팀 별도 프로젝트) | `ending_inventory` 재고 단가 | `lib/ending-inventory-price.ts`, REST 직접 호출 |
| Neon Postgres | Python ML 파이프라인이 write 한 수요예측. **읽기 전용** | `lib/neon.ts` |

주요 SAP 테이블: `SD_ZASSDDV0020`(납품/주문), `V_SD_SO1`(청구매출), `PP_ZASPPR1110`(생산오더),
`V_MM_MCHB_ALL`·`MM_MCHB`(플랜트 배치재고), `V_WMV_CST_INVNLIST`(FBH 물류센터 재고),
`SD_MARA`(자재마스터), `PP_STPO`(BOM), `MM_MARD`(자재재고), `MM_MB51`(자재이동), `MM_ZMMR1140`(자재마스터/단가), `MM_ZMMR0020`(발주).

**Supabase 프로젝트는 사내 다른 앱들과 공유한다.** 이 앱이 만드는 테이블은 전부 `snop_` 접두어를 붙인다
(`snop_profiles`, `snop_bom_leaf`, `snop_bom_build_runs`, `snop_product_owners`, `snop_material_thresholds`,
`snop_inventory_daily_snapshots`, `snop_user_favorites`, `snop_user_favorite_customers`).
`auth.users` 도 공유되므로 로그인 계정은 회사 이메일이 아니라 `<login_id>@snop.local` 내부 주소로 만든다(`lib/pin-auth.ts`).
스키마 변경은 `supabase/*.sql` 에 파일로 남기고 대시보드에서 수동 실행한다(마이그레이션 러너 없음).

## 아키텍처

```
app/<route>/page.tsx      Server Component. 서버에서 actions 호출 → 클라이언트 컴포넌트에 initialData 전달
actions/*.ts              'use server'. BigQuery/Supabase 실행 + unstable_cache. 여기에 계산 로직을 두지 않는다
lib/**                    순수 함수 (SQL 문자열 생성, 행 변환, 판정·집계 엔진) + 클라이언트 팩토리
types/                    sap.ts(원본 컬럼), analysis.ts·material.ts(도메인 타입)
hooks/, store/            react-query 훅 + zustand(날짜 범위, UI 상태)
components/               차트는 외부 라이브러리 없이 canvas 직접 구현(components/charts/)
middleware.ts             전 경로 인증 게이트
```

라우팅은 사이드바(`components/sidebar.tsx`)의 `menuItems` 가 사실상의 목차다.
`/admin/*` 메뉴는 `/api/admin/status` 응답에 따라 클라이언트에서만 숨겨지므로,
**관리자 전용 서버 액션은 반드시 `getAdminContext()` 로 다시 확인해야 한다.**

재고 현황과 재고 분석은 `/stock` 한 장표로 합쳐져 있고(품목 단위 ↔ 배치 단위 전환, 행 펼치면 배치 상세),
판정·집계는 전부 `lib/inventory-board.ts` 순수 함수에 있다 — 화면은 표시만 한다.
`/inventory` 는 필터 쿼리를 들고 `/stock` 으로 넘기는 리다이렉트다(예전 공유 링크 보존). **다시 두 화면으로 쪼개지 말 것.**

### 캐시 규약

모든 무거운 조회는 `unstable_cache(fn, [버전이 박힌 키], { revalidate: 600, tags: ['report-data'] })` 이다.
키에 버전 문자열을 넣는 것이 관례다 (`dashboard-analysis-v7-...`, `material-facts-v4-direct-bom`,
`material-requirements-v2-3-to-12-months`). **계산 결과가 바뀌는 수정을 했으면 키 버전을 올려야** 캐시가 갈린다.

**항목당 2MB 제한**을 넘으면 저장이 조용히 실패하고 매 요청 BigQuery 를 다시 때린다.
그래서 대시보드 분석 결과와 자재 소요량 집계는 `gzipSync(...).toString('base64')` 로 넣고 꺼낼 때 푼다
(`actions/dashboard-actions.ts`, `actions/material-actions.ts`). 새로 큰 결과를 캐시할 때도 이 패턴을 따르고,
`verify:bom` 의 크기 체크를 확인한다.

### 인증

`middleware.ts` 가 모든 경로를 감시한다. 공개 경로는 `/login`, `/reset-password`, `/unauthorized`,
`/auth`, `/api/notice`, `/api/mcp`, `/api/cron`, 정적 파일뿐이다.
로그인했더라도 `snop_profiles.status !== 'active'` 이면 `/unauthorized` 로 보낸다(관리자 이메일은 예외).

- 관리자 판정: `ADMIN_EMAILS` 환경변수 + `lib/admin-auth.ts` 의 `DEFAULT_ADMIN_EMAILS` + `snop_profiles.role/is_admin`.
- 로그인은 ID + 6자리 PIN 방식(`lib/pin-auth.ts`) — 5회 실패 시 15분 잠금, 쉬운 PIN 거부, 실패 문구는 항상 동일.
- `/api/mcp` 는 쿠키가 없는 클라이언트용이라 미들웨어를 통과시키고 라우트에서 `MCP_TOKEN` 으로 인증한다.
  `/.well-known/oauth-*` 는 **반드시 404** 로 끊어야 한다(로그인 페이지로 리다이렉트하면 MCP 커넥터 등록이 실패한다).
- `/api/cron/*` 은 `CRON_SECRET` Bearer 로 라우트 내부에서 인증한다. Vercel Cron 은 `vercel.json` 에 정의(매일 21:45 UTC 재고 스냅샷).

### MCP 서버

`lib/mcp/handler.ts` 가 JSON-RPC 2.0 over Streamable HTTP(POST 전용, SSE 없음)로 재고 조회 툴 4개를 노출한다.
`/api/mcp/[token]`(앱 커넥터용 URL 토큰)과 `/api/mcp`(Bearer 헤더)를 둘 다 받는다.
툴을 추가하면 `TOOLS` 배열, `callTool` 스위치, `SERVER_INSTRUCTIONS`(모델에게 "제공하지 않는 것"을 명시하는 문장)를 함께 고친다.

## 도메인 규칙 — 숫자가 틀리는 지점들

이 앱의 버그는 대부분 UI 가 아니라 아래 판정 기준에서 나온다. 관련 코드를 고칠 땐 주석의 실측치를 먼저 읽을 것.

- **자재코드 대역이 스코프다.** 완제품·상품 = `50000000`~`69999999`. 자재는 앞자리로 구분:
  1=원재료 2=부재료 3=포장재 4=반제품 5=자사소재 6=상품 (`lib/bom/explosion-sql.ts` `MATERIAL_CLASS_LABEL`).
  BOM 전개 스코프와 재고/발주 쿼리의 대역이 어긋나면 모수가 갈린다.
- **재고 단가는 SAP 표준가(STPRS)를 쓰지 않는다.** 미사용 자재에 5천만원/EA 같은 값이 남아 금액이 30배 튀었다.
  원가팀 `ending_inventory`(별도 Supabase) 단가만 쓰고, 거기 없는 자재는 금액을 만들지 말고 `CURRENT_MONTH`(당월생산)로 표기한다.
  `as_of_month` 는 "그 달의 기초" = 전월 기말이다.
- **매출 기준이 두 개다.** 대시보드 기본은 납품매출(`SD_ZASSDDV0020`, VDATU 납품요청일). 청구매출은 `V_SD_SO1`(FKDAT), VTWEG 10=내수 20=수출.
  둘을 섞어 비교하지 말 것.
- **생산실적은 `PP_ZASPPR1110` 이 아니라 `MM_MB51`(BWART 101-102)** 로 센다. 생산오더 테이블은 최근 건이 누락된다.
  자재 사용량도 MB51 261-262 기준이다. BOX 입고는 `SD_MARA.UMREZ_BOX` 로 기본단위(EA) 환산한다.
- **유통기한 판정**: 폐기 ≤0일 / 임박 1~30 / 긴급 31~60 / 양호 61+ / 기한없음.
  SAP 더미 날짜(`00000000`, 1899·1900·1970, 2000년 미만)는 `safeExtractDateStr`(`lib/analysis.ts`)로 전부 '기한없음' 처리한다.
  품목 대표 상태는 **수량 기준 다수결**이다 — 배치 1건 폐기로 품목 전체가 폐기로 물들지 않게 하기 위한 것.
- **재고 구분·생산라인은 DISPO(MRP 관리자) 코드**로 판정한다(`lib/inventory-classification.ts`).
  6으로 시작=상품, 5+A*=자소용, 5+M*=판매용. M01~M32 가 생산라인이다.
- **BOM 전개(`lib/bom/explosion-sql.ts`)** 에는 되돌리면 안 되는 결정이 여럿 있다:
  POSNR 단위 dedupe 필수(8배 부풀림), 동일 자식 복수 POSNR 은 DISTINCT 아닌 **SUM**,
  `FMENG='X'`(로트 고정수량)은 완제품 1개당 환산 불가라 계수 0 + 플래그, `BMENG=1`인데 자식 100 초과는 로트기준 오등록 의심 플래그,
  PATH 기반 순환 가드(완제품이 다른 완제품의 자식으로 들어오는 멀티팩 구성이 실재), 깊이 상한 14.
  `MATNR_T LIKE '%미사용%'` 제외는 필수(FERT 4,517 중 1,567이 미사용).
- **발주 테이블 `MM_ZMMR0020` 은 PO 아이템이 입고문서마다 반복된다**(실측 3.44배). `EBELN+EBELP` GROUP BY 없이 쓰면 잔량·금액이 그만큼 부풀려진다.
- **BOM 마트 갱신 순서**: 새 `build_id` 로 upsert 를 전부 끝낸 뒤에 구 build 를 지운다. DELETE 를 먼저 하면 조회 측이 빈 구간을 본다
  (재고 일별 스냅샷 `lib/inventory-daily-snapshot.ts` 와 순서가 반대다).
- **자재 위험 판정 기준은 화면에 그대로 노출한다**(`describeRiskCriteria`, `describeMaterialStatuses`).
  판정 로직을 바꾸면 이 설명 문자열도 같이 고쳐야 한다 — "왜 위험으로 잡혔나"를 사용자가 임계값까지 보고 판단하는 구조다.
- 자재 공용/전용(`SHARED`/`DEDICATED`)은 **BOM 사실**로, 담당자 지분은 **최근 실적**으로 판정한다. 서로 다른 기준이며 의도된 것이다.

## 환경변수 (`.env.local`, 커밋 금지)

`GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`(`\n` 이스케이프 허용),
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`,
`ENDING_INVENTORY_SUPABASE_URL` / `ENDING_INVENTORY_SUPABASE_ANON_KEY`,
`NEON_DATABASE_URL`, `ADMIN_EMAILS`, `MCP_TOKEN`, `CRON_SECRET`(Vercel 전용),
선택: `GOOGLE_SHEETS_PRODUCT_CODE_SPREADSHEET_ID` / `_SHEET_NAME`.

Vercel 배포. `next.config.ts` 의 `images.unoptimized: true` 는 무료 플랜 이미지 최적화 한도 회피용이므로 되돌리지 말 것.
