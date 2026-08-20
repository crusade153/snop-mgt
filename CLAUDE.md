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
npm run verify:ads # 재고 장표 ADS(판매출고+생산투입) 실데이터 검증
npm run verify:weekly # 주간 요약장표(주차 계산·분류·적재 불변식) 실데이터 검증
```

**테스트 프레임워크가 없다.** 자동 검증은 `scripts/verify-bom-mart.mjs`·`verify-ads.mjs`·`verify-weekly.mjs` 뿐이며,
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
`snop_inventory_daily_snapshots`, `snop_weekly_inventory_snapshots`, `snop_cm_mapping`, `snop_weekly_board_notes`,
`snop_user_favorites`, `snop_user_favorite_customers`).
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

`/weekly` 는 주간 완제품 재고 요약장표다(수기 엑셀 「1. 완제품 재고현황」 대체). 설계 근거는 `docs/weekly-summary-board.md`.
예전 `/daily`(일일 관리) 화면 자리를 대신하며, **화면만 지웠고 일별 스냅샷 cron·`snop_inventory_daily_snapshots`·MCP 아침브리핑은 그대로 살아 있다.**
이 장표는 BigQuery 를 읽지 않는다 — 주 1회 적재해 둔 `snop_weekly_inventory_snapshots` 만 읽는다.

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
- `/api/cron/*` 은 `CRON_SECRET` Bearer 로 라우트 내부에서 인증한다. Vercel Cron 은 `vercel.json` 에 정의(매일 21:45 UTC 일별 재고 스냅샷, 일요일 20:40 UTC = 월요일 05:40 KST 주간 스냅샷).

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
  원가팀 `ending_inventory`(별도 Supabase) 단가만 쓴다. **최신 마감월에 없으면 과거월로 최대 6개월 역탐색**하고,
  그래도 없으면 금액을 만들지 말고 `CURRENT_MONTH`(당월생산)로 표기한다. 어느 월 단가를 썼는지는
  `resolveUnitPrice` 가 돌려주는 `priceMonth` 로 따라다니므로 화면에서 "최신 단가가 아님"을 숨기지 않는다.
  `as_of_month` 는 "그 달의 기초" = 전월 기말이다.
- **ADS 는 판매속도가 아니라 소진속도다.** `납품출고(SD_ZASSDDV0020, 601 성격) + 생산투입 순소요(MB51 261-262)`.
  스프·양념장·소스처럼 제품 코드(5xxxxxxx)로 등록됐지만 다시 다른 제품의 자재로 투입되는 품목이
  판매출고만 세면 '소진 0' 이라 회전일이 영원히 비었다. 실측(최근 90일): 재고 보유 752품목 중 449품목에 261 투입이 있고
  그중 130품목은 납품출고가 0, 전체 순투입 11,803,490 > 납품출고 10,238,786 으로 모수가 오히려 더 크다.
  262 취소가 261 투입을 넘기는 구간은 0 으로 막는다(음수 ADS 금지). 판단 근거 문구는 `/stock` 의 `ADS_BASIS_TEXT` 에 그대로 노출한다.
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
- **주간 요약장표(`/weekly`)의 판정 기준** — `lib/weekly/classification.ts` 하나에 모여 있다.
  카테고리는 DISPO 의 **뒤 두 자리**로 판정한다: 냉동 01~05·10 / HMI 06~09 / 즉석밥 30~32 / 라면 11~17·19 / 나머지 기타.
  **접두 문자 M(생산)과 A(자소용)는 뒤 두 자리가 같으면 같은 분류다**(A08 = M08 = 소스 → HMI). 모르는 접두는 섞지 않고 기타로 남긴다.
  **H01(상품)만 `상품` 카테고리 + `상품` CM 으로 빠져 CM1~CM3 과 합산되지 않는다**(합계행에는 포함).
  M13(전처리)은 조직상 K1 냉동팀_전처리지만 **이 장표에서는 라면(K3)** 이고, M31(FD)은 카테고리 축 때문에 K2 즉석밥에 함께 잡힌다 — 둘 다 확인을 거친 결정이다.
  DISPO 는 `MM_MARD` 에서 **생산 플랜트(1021·1022·1023)만** 뽑는다. 1031(판매법인)의 DISPO 는 M33·M36 같은 영업용 코드라 생산라인이 아니다.
  ⚠️ 아직 남은 미매핑은 **M18(9.3억)과 마스터없음(7.0억) 둘뿐**이다(실측 재고금액의 12.6%, A 계열 흡수 전에는 26.5%였다). 기준정보 정비 중이라 의도적으로 기타에 둔다.
  집계는 적재 당시 굳은 `category` 열이 아니라 **`dispo` 원본에서 다시 판정한다**(`lib/weekly/board.ts` `classifyRow`). 그래서 매핑을 넓히면 과거 주차까지 같이 다시 접힌다.
- **주간 장표의 금액은 재고·주간출고·누적출고·생산이 전부 같은 단가**(원가팀 기말재고 단가)로 환산된다.
  「월 출고 比 재고금액」의 분모도 **누적 출고금액(원가)** 이다 — 예전 분모였던 매출액(NETWR)은 판매가라
  분자(원가)와 기준이 달라 마진율만큼 비율이 눌렸고, "몇 주치 재고인가"로 읽을 수 없었다. NETWR 은 참고용으로만 적재한다.
  출고·생산은 SKU 단위 값이라 창고그룹으로 못 나누므로 **SKU 당 한 그룹에만 싣되, 기본 스코프(플랜트·물류)를 우선**한다.
  재고가 가장 큰 그룹으로 고르면 기타 창고 위주 SKU 의 출고가 기본 화면에서 통째로 빠진다(실측 0.32억, 전체 출고의 2.5%).
- **주간 장표의 재고금액은 `/stock` 과 원 단위까지 같아야 한다.** 범위(저장위치 9개 제외 + 3000 제외), 수량(CLABS), 단가 규칙이 셋 다 같기 때문이다.
  ⚠️ 특히 **단가는 배치가 있는 플랜트(MM_MCHB 의 WERKS) 기준**으로 환산한다. 재고 뷰 `V_MM_MCHB_ALL` 에는 WERKS 가 없어서 조인이 필요하고,
  자재마스터(MM_MARD)의 대표 플랜트 하나로 뭉뚱그리면 1021·1022 에 나뉜 자재의 금액이 갈린다(실측 68품목·0.04억 차이였다).
  그래서 적재 누적은 **수량이 아니라 금액**으로 한다(`lib/weekly/snapshot-builder.ts`). 화면에 남는 차이는 「실시간 vs 적재 시점」 시간차뿐이고, 적재 시각을 제목 옆에 노출해 그 차이를 설명한다.
- **주간 장표의 창고 그룹** — 플랜트 / 물류(FBH) / 기타창고 3개다. 기타창고는 다른 화면이 통째로 제외하던 저장위치들이다.
  ⚠️ **저장위치 3000(물류창고)은 어느 그룹에도 넣지 않는다.** FBH 물류센터 재고의 SAP 측 미러라서(실측: 445품목 중 381품목이 FBH 에도 있고 32품목은 수량까지 일치) 넣으면 물류 재고를 두 번 센다.
  이 3그룹 합계는 `/weekly` 안에서만 쓴다. `/stock`·MCP 의 기존 「통합 재고」 정의는 건드리지 않는다.
- **주간 재고는 소급 생성이 불가능하다.** `V_MM_MCHB_ALL` 은 "지금" 재고만 준다. 그래서 같은 주차를 다시 적재해도
  **재고 열은 최초 1회분을 유지하고 출고·생산·매출만 다시 계산한다**(전표 이력이라 소급 가능). 이 순서를 뒤집지 말 것.
- 자재 공용/전용(`SHARED`/`DEDICATED`)은 **BOM 사실**로, 담당자 지분은 **최근 실적**으로 판정한다. 서로 다른 기준이며 의도된 것이다.

## 환경변수 (`.env.local`, 커밋 금지)

`GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY`(`\n` 이스케이프 허용),
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`,
`ENDING_INVENTORY_SUPABASE_URL` / `ENDING_INVENTORY_SUPABASE_ANON_KEY`,
`NEON_DATABASE_URL`, `ADMIN_EMAILS`, `MCP_TOKEN`, `CRON_SECRET`(Vercel 전용),
선택: `GOOGLE_SHEETS_PRODUCT_CODE_SPREADSHEET_ID` / `_SHEET_NAME`.

Vercel 배포. `next.config.ts` 의 `images.unoptimized: true` 는 무료 플랜 이미지 최적화 한도 회피용이므로 되돌리지 말 것.
