# S&OP 재고현황 MCP 서버 — 연결 가이드

> 채울 값은 두 개뿐입니다.
> - `BASE_URL` : 배포 도메인 (예: `https://snop-mgt.vercel.app`)
> - `MCP_TOKEN` : 관리자에게 받은 토큰 문자열 (원가관리팀 유경덕)

---

## 1. 먼저 짚고 갈 것 — OAuth 가 아닙니다

이 서버는 **OAuth 를 쓰지 않습니다.** client id / client secret / redirect URI / 동의화면 같은 건 없습니다.
인증은 **고정 토큰 하나**이고, 방식은 아래 두 가지뿐입니다.

| 방식 | 엔드포인트 | 인증 | 쓰는 곳 |
| --- | --- | --- | --- |
| **헤더 인증 (권장)** | `POST {BASE_URL}/api/mcp` | `Authorization: Bearer {MCP_TOKEN}` | Claude Code, Cursor, VS Code, 직접 구현한 클라이언트 등 헤더를 지정할 수 있는 모든 클라이언트 |
| URL 토큰 | `POST {BASE_URL}/api/mcp/{MCP_TOKEN}` | URL 경로에 토큰 | Claude 웹/데스크톱 "커스텀 커넥터"처럼 URL 칸 하나만 있는 등록 폼 |

**클라이언트가 OAuth 로그인 창을 띄우거나 "authorization server를 찾을 수 없다"고 하면, 설정이 잘못된 것입니다.**
`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration` 은 **의도적으로 404** 를 반환합니다.
(로그인 페이지로 리다이렉트하면 클라이언트가 OAuth 서버가 있는 줄 알고 등록에 실패하기 때문에 일부러 끊어둔 것입니다.)
→ OAuth 를 찾는 클라이언트는 "OAuth 없음 / 헤더 토큰" 모드로 설정해야 합니다.

### 전송 규격

- **Streamable HTTP + JSON-RPC 2.0**, **POST 전용**입니다.
- **SSE 스트림을 제공하지 않습니다.** `GET`·`DELETE` 는 `405 Allow: POST` 로 끊습니다.
  클라이언트 설정에서 transport 를 고를 수 있으면 `sse` 가 아니라 `http`(streamable-http)로 지정하세요.
- 지원 protocolVersion : `2025-06-18`(기본), `2025-03-26`, `2024-11-05`
- JSON-RPC **배치 요청은 미지원**입니다.

---

## 2. 클라이언트별 설정 예시

### Claude Code (CLI) — 한 줄

```bash
claude mcp add --transport http snop-inventory https://BASE_URL/api/mcp --header "Authorization: Bearer MCP_TOKEN"
```

### 설정 파일 방식 (`.mcp.json` / `mcp.json` / Cursor·VS Code 공통 형태)

```json
{
  "mcpServers": {
    "snop-inventory": {
      "type": "http",
      "url": "https://BASE_URL/api/mcp",
      "headers": {
        "Authorization": "Bearer MCP_TOKEN"
      }
    }
  }
}
```

- Cursor : `~/.cursor/mcp.json` (또는 프로젝트 `.cursor/mcp.json`)
- VS Code : `.vscode/mcp.json` — 키 이름이 `servers` 인 버전도 있으니 해당 에디터 문서를 따르세요. `type` 값은 `http`.
- 프로젝트 공유용 : 리포지토리 루트 `.mcp.json`

### Claude 데스크톱 앱 (헤더 입력 칸이 없는 경우)

두 가지 중 하나를 쓰면 됩니다.

**(a) 커스텀 커넥터 — URL 토큰 방식**
설정 → 커넥터 → 커스텀 커넥터 추가 → URL 칸에 아래를 그대로 붙여넣습니다.

```
https://BASE_URL/api/mcp/MCP_TOKEN
```

**(b) 헤더 인증을 꼭 써야 하면 — `mcp-remote` 브리지**
`claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "snop-inventory": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://BASE_URL/api/mcp",
        "--transport", "http-only",
        "--header", "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer MCP_TOKEN" }
    }
  }
}
```

> `--header` 값에 공백이 들어가면 인자가 잘리는 클라이언트가 있어, 위처럼 `env` 로 넘기고
> `Authorization:${AUTH_HEADER}` 형태(콜론 뒤 공백 없음)로 적는 것이 안전합니다.

---

## 3. 연결 확인 (curl)

설정 전에 이 세 줄로 서버가 살아있는지부터 확인하는 편이 빠릅니다.

**초기화 (initialize)**

```bash
curl -sS -X POST https://BASE_URL/api/mcp -H "Authorization: Bearer MCP_TOKEN" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

**툴 목록 (tools/list)**

```bash
curl -sS -X POST https://BASE_URL/api/mcp -H "Authorization: Bearer MCP_TOKEN" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

**툴 호출 (tools/call)**

```bash
curl -sS -X POST https://BASE_URL/api/mcp -H "Authorization: Bearer MCP_TOKEN" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"inventory_overview","arguments":{}}}'
```

응답이 `{"jsonrpc":"2.0","id":1,"result":{...}}` 형태로 오면 정상입니다.

---

## 4. 제공 툴 4개 (전부 읽기 전용)

| 툴 | 하는 일 | 인자 |
| --- | --- | --- |
| `inventory_overview` | 전체 재고 요약 — 총 수량·금액·품목수 + 유통기한 상태별(폐기/임박/긴급/양호/기한없음) 내역 | 없음 |
| `inventory_group_summary` | 제품군·브랜드·카테고리·생산라인·재고구분별 집계 순위 | `groupBy`(family/category/brand/productionLine/stockType), `sortBy`(value/quantity/riskValue/riskQuantity), `limit`(1~30, 기본 10) |
| `inventory_risk_items` | 폐기·임박(또는 긴급) 재고 품목 리스트 | `bucket`(disposed_imminent/disposed/imminent/critical), `groupBy`+`groupValue`(부분일치 필터), `sortBy`(value/quantity/remainDays), `limit`(1~50, 기본 20) |
| `inventory_morning_briefing` | 일별 스냅샷 기준 아침 브리핑 — 전일 대비, 신규 임박 진입, 임박→폐기 이동 | 없음 |

**호출 예시 — 임박 재고가 몰린 제품군 상위 5개**

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"inventory_group_summary","arguments":{"groupBy":"family","sortBy":"riskValue","limit":5}}}
```

**호출 예시 — 즉석밥 제품군의 폐기 대상 품목**

```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"inventory_risk_items","arguments":{"bucket":"disposed","groupBy":"family","groupValue":"즉석밥","sortBy":"remainDays","limit":20}}}
```

### 데이터 범위 (모델에게도 이렇게 안내됩니다)

- 제공: 플랜트 + 물류센터(FBH) 통합 가용재고의 수량·평가금액, 유통기한 상태, 제품계층·생산라인·재고구분별 집계
- **미제공: 매출 / 수주 / 생산실적 / 원가 / 고객 정보** — 이 툴들로는 답이 안 나옵니다
- 상태 기준(고정): 폐기 = 잔여 0일 이하, 임박 = 1~30일, 긴급 = 31~60일, 양호 = 61일 이상
- 금액은 원가팀 기말재고 단가 기준이며, 단가가 없는 품목은 0으로 잡힙니다 → **금액과 수량을 항상 같이 보세요**

---

## 5. 문제 해결

| 증상 | 원인 | 조치 |
| --- | --- | --- |
| OAuth 로그인 창이 뜬다 / "authorization server 없음" | 클라이언트가 OAuth 자동탐색을 시도 중 | 이 서버는 OAuth 미지원. 커넥터를 지우고 **헤더 토큰 방식**으로 다시 등록 (`/.well-known/oauth-*` 404 는 정상) |
| `401` + "인증 실패: URL 경로에 토큰..." | 토큰 불일치 또는 헤더 누락 | `Authorization: Bearer ` 접두어 확인, 토큰 앞뒤 공백·줄바꿈 제거 |
| `405 Allow: POST` | 클라이언트가 GET(SSE)으로 접속 시도 | transport 를 `sse` 가 아니라 `http`/streamable-http 로 변경 |
| `503` + "MCP_TOKEN 환경변수가 설정되지 않아..." | 서버 측 환경변수 미설정 | 관리자에게 문의 (Vercel 환경변수 `MCP_TOKEN`) |
| `-32600` "배치 요청은 지원하지 않습니다" | JSON-RPC 배치 전송 | 요청을 하나씩 보내도록 설정 |
| 로그인 페이지 HTML 이 돌아온다 | `/api/mcp` 가 아닌 다른 경로로 요청 | 경로 오타 확인 (`/api/mcp`, `/api/mcp/{TOKEN}` 두 개만 열려 있음) |

---

## 6. 토큰 취급

- 토큰은 **비밀번호와 동일**하게 다뤄 주세요. 메신저 단체방·이슈 트래커에 붙여넣지 마세요.
- URL 토큰 방식(`/api/mcp/{TOKEN}`)은 토큰이 접근로그·브라우저 기록에 남습니다. 헤더 방식이 가능하면 헤더를 쓰세요.
- 유출이 의심되면 관리자에게 알려 `MCP_TOKEN` 을 교체하면 됩니다(교체 시 모든 클라이언트 재설정 필요).

문의: 원가관리팀 유경덕 (yukd2022@harim-foods.com)
