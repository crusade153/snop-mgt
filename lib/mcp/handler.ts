/**
 * MCP(Model Context Protocol) 공용 핸들러 — 재고현황 전용 1차 버전
 *
 * 전송방식 : Streamable HTTP (POST + JSON-RPC 2.0). SSE 스트림은 쓰지 않는다.
 * 인증     : 환경변수 MCP_TOKEN 과 대조하며, 두 가지 경로를 모두 허용한다.
 *   1) URL 경로       : POST /api/mcp/<MCP_TOKEN>
 *      → Claude 웹/데스크톱 "커스텀 커넥터" 폼은 헤더를 넣을 칸이 없어 URL만 받는다.
 *        그 폼에 붙여넣어 쓰는 용도. 토큰이 URL(접근로그)에 남는 점은 감수한 선택이다.
 *   2) 요청 헤더      : Authorization: Bearer <MCP_TOKEN>  (POST /api/mcp)
 *      → Claude Code(CLI) 등 헤더를 지정할 수 있는 클라이언트용. 토큰이 URL에 남지 않는다.
 *
 * 노출 툴 3개는 모두 읽기 전용이며, 대시보드와 동일한 캐시된 데이터를 사용한다.
 */

import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import {
  getInventoryGroupSummary,
  getInventoryOverview,
  getInventoryRiskItems,
} from '@/lib/mcp/inventory-insights';
import { getInventoryMorningBriefing } from '@/lib/inventory-daily-snapshot';

const SERVER_INFO = { name: 'snop-inventory', version: '1.0.0' };
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

/** 모델이 이 서버가 무엇을 아는지/모르는지 헷갈리지 않도록 하는 안내문 */
const SERVER_INSTRUCTIONS = [
  '하림 S&OP 재고현황 데이터를 조회하는 읽기 전용 서버다.',
  '제공 범위: 플랜트 + 물류센터(FBH) 통합 가용재고의 수량·평가금액, 유통기한 상태(폐기/임박/긴급/양호/기한없음), 제품계층(브랜드·카테고리·제품군)·생산라인·재고구분별 집계.',
  '제공하지 않는 것: 매출/수주/생산실적/원가/고객 정보. 이 서버 툴로는 답할 수 없으니 추측하지 말 것.',
  '상태 판정 기준은 고정이다 — 폐기=잔여 0일 이하, 임박=1~30일, 긴급=31~60일, 양호=61일 이상.',
  '넓은 질문에는 inventory_group_summary 로 먼저 그룹 순위를 보고, 이어서 inventory_risk_items 로 품목을 좁히는 순서를 권장한다.',
  '매일 아침 브리핑에는 inventory_morning_briefing 을 사용한다. 이 도구는 일별 스냅샷 기준의 전일 대비·신규 진입·임박에서 폐기로 이동한 품목을 반환한다.',
  '금액은 원가팀 기말재고 단가 기준이며 단가가 없는 품목은 0으로 잡히므로, 금액과 수량을 함께 확인할 것.',
].join(' ');

const TOOLS = [
  {
    name: 'inventory_overview',
    description:
      '전체 재고 현황을 한 장으로 요약한다. 총 재고수량·재고금액·품목수와 유통기한 상태별(폐기/임박/긴급/양호/기한없음) 수량·금액·품목수를 반환한다. ' +
      '"지금 재고 어때?", "임박 재고 얼마나 돼?" 같은 첫 질문에 먼저 쓴다. 인자는 없다. 제품군별 내역이 필요하면 inventory_group_summary 를 쓸 것.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'inventory_group_summary',
    description:
      '제품군·브랜드·카테고리·생산라인·재고구분 단위로 재고를 집계해 순위로 반환한다. ' +
      '"어느 제품군에 재고가 가장 많은가", "임박·폐기 재고가 몰린 제품군은 어디인가"에 답하는 툴이다. ' +
      '각 그룹마다 재고수량/재고금액/품목수와 함께 폐기·임박·긴급 수량과 금액, 폐기+임박 수량비중(%)을 같이 준다. ' +
      '재고가 많은 곳을 찾을 때는 sortBy=value(또는 quantity), 위험이 몰린 곳을 찾을 때는 sortBy=riskValue(또는 riskQuantity)를 쓴다.',
    inputSchema: {
      type: 'object',
      properties: {
        groupBy: {
          type: 'string',
          enum: ['family', 'category', 'brand', 'productionLine', 'stockType'],
          description:
            '집계 단위. family=제품군(제품계층3, 기본값), category=카테고리(제품계층2), brand=브랜드(제품계층1), productionLine=생산라인(냉동밥·즉석밥1라인 등), stockType=재고구분(자소용/판매용/상품).',
        },
        sortBy: {
          type: 'string',
          enum: ['value', 'quantity', 'riskValue', 'riskQuantity'],
          description:
            '정렬 기준. value=재고금액 큰 순(기본값), quantity=재고수량 많은 순, riskValue=폐기+임박 금액 큰 순, riskQuantity=폐기+임박 수량 많은 순.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description: '반환할 그룹 개수. 기본 10, 최대 30.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inventory_risk_items',
    description:
      '폐기·임박(또는 긴급) 재고를 품목 단위 리스트로 반환한다. 품목마다 자재코드·품목명·제품군·생산라인·수량·금액·최단잔여일수·가장 빠른 유통기한·주요 보관처를 준다. ' +
      '"임박 재고 품목 리스트 뽑아줘", "OO 제품군에서 폐기 대상이 뭐야" 같은 질문에 쓴다. ' +
      'groupBy+groupValue 로 특정 제품군/브랜드/생산라인만 좁혀 볼 수 있다(부분 일치). 결과가 많으면 상위 N건만 반환되며 총 건수는 해당품목수 필드로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: {
          type: 'string',
          enum: ['disposed_imminent', 'disposed', 'imminent', 'critical'],
          description:
            '조회 대상. disposed_imminent=폐기+임박 전체(기본값), disposed=폐기(잔여 0일 이하)만, imminent=임박(1~30일)만, critical=긴급(31~60일)만.',
        },
        groupBy: {
          type: 'string',
          enum: ['family', 'category', 'brand', 'productionLine', 'stockType'],
          description: '필터 기준 축. groupValue 와 반드시 함께 쓴다.',
        },
        groupValue: {
          type: 'string',
          description: '필터 값(부분 일치, 예: "즉석밥", "냉동만두"). groupBy 와 함께 쓴다.',
        },
        sortBy: {
          type: 'string',
          enum: ['value', 'quantity', 'remainDays'],
          description: '정렬 기준. value=금액 큰 순(기본값), quantity=수량 많은 순, remainDays=잔여일수 짧은(급한) 순.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: '반환할 품목 개수. 기본 20, 최대 50.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inventory_morning_briefing',
    description:
      '매일 아침 재고 관리 브리핑용 요약을 반환한다. 최신 일별 스냅샷 기준으로 폐기·임박·긴급 버킷의 수량/금액/품목수, 전일 대비, 신규 임박 진입, 임박에서 폐기로 이동한 품목 수, 상위 5개 집중도와 액션 그룹별 소계를 준다. ' +
      '세부 품목은 웹앱에서 확인하도록 하고, 이 결과만 간결하게 한국어 브리핑으로 요약한다. 인자는 없다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// ---------------------------------------------------------------- 인증

/** 길이 노출을 줄이기 위해 항상 고정 길이 비교로 맞춘다. */
function matchesToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(request: NextRequest, pathToken?: string): boolean {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;

  // 1) URL 경로로 넘어온 토큰 (앱 커스텀 커넥터용)
  if (pathToken && matchesToken(decodeURIComponent(pathToken).trim(), expected)) return true;

  // 2) Authorization 헤더 (CLI 등 헤더 지정이 가능한 클라이언트용)
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return Boolean(provided) && matchesToken(provided, expected);
}

// ---------------------------------------------------------------- JSON-RPC

type JsonRpcId = string | number | null;

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, httpStatus = 200) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status: httpStatus });
}

function toolResult(payload: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

async function callTool(name: string, args: Record<string, any>) {
  switch (name) {
    case 'inventory_overview':
      return toolResult(await getInventoryOverview());
    case 'inventory_group_summary':
      return toolResult(await getInventoryGroupSummary(args));
    case 'inventory_risk_items':
      return toolResult(await getInventoryRiskItems(args));
    case 'inventory_morning_briefing':
      return toolResult(await getInventoryMorningBriefing());
    default:
      throw new Error(`알 수 없는 툴: ${name}`);
  }
}

/**
 * @param pathToken /api/mcp/<token> 형태로 들어온 경우의 경로 토큰
 */
export async function handleMcpPost(request: NextRequest, pathToken?: string) {
  if (!process.env.MCP_TOKEN) {
    return jsonRpcError(null, -32000, 'MCP_TOKEN 환경변수가 설정되지 않아 서버가 비활성화되어 있습니다.', 503);
  }
  if (!isAuthorized(request, pathToken)) {
    return jsonRpcError(
      null,
      -32001,
      '인증 실패: URL 경로에 토큰(/api/mcp/<MCP_TOKEN>)을 넣거나 Authorization: Bearer <MCP_TOKEN> 헤더를 보내야 합니다.',
      401,
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  if (Array.isArray(body)) {
    return jsonRpcError(null, -32600, 'JSON-RPC 배치 요청은 지원하지 않습니다.');
  }

  const { id = null, method, params } = body ?? {};

  // 알림(notification)은 id가 없다 — 본문 없이 202로 응답한다.
  if (method && (id === null || id === undefined) && String(method).startsWith('notifications/')) {
    return new Response(null, { status: 202 });
  }

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
        return jsonRpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        });
      }

      case 'ping':
        return jsonRpcResult(id, {});

      case 'tools/list':
        return jsonRpcResult(id, { tools: TOOLS });

      case 'tools/call': {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (!name) return jsonRpcError(id, -32602, 'params.name 이 필요합니다.');

        try {
          return jsonRpcResult(id, await callTool(name, args));
        } catch (e: any) {
          // 툴 실행 오류는 프로토콜 오류가 아니라 isError 결과로 돌려준다.
          console.error('[MCP] tool error:', name, e?.message);
          return jsonRpcResult(id, {
            isError: true,
            content: [{ type: 'text', text: `툴 실행 실패: ${e?.message || '알 수 없는 오류'}` }],
          });
        }
      }

      case 'resources/list':
        return jsonRpcResult(id, { resources: [] });

      case 'prompts/list':
        return jsonRpcResult(id, { prompts: [] });

      default:
        return jsonRpcError(id, -32601, `지원하지 않는 메서드: ${method}`);
    }
  } catch (e: any) {
    console.error('[MCP] internal error:', e?.message);
    return jsonRpcError(id, -32603, `내부 오류: ${e?.message || 'unknown'}`);
  }
}

/** SSE 스트림은 제공하지 않는다. 클라이언트가 GET 으로 열려고 하면 405 로 알려준다. */
export function handleMcpGet() {
  return Response.json(
    { error: 'This MCP endpoint supports POST (JSON-RPC over Streamable HTTP) only.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

export function handleMcpDelete() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
