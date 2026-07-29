/**
 * MCP 엔드포인트 — 헤더 인증용 경로
 *
 * URL : https://<배포도메인>/api/mcp
 * 인증: Authorization: Bearer <MCP_TOKEN>
 *
 * Claude Code(CLI)처럼 헤더를 지정할 수 있는 클라이언트가 쓴다.
 * 헤더를 넣을 수 없는 앱 커스텀 커넥터는 /api/mcp/<MCP_TOKEN> 경로를 쓸 것.
 */

import { NextRequest } from 'next/server';
import { handleMcpDelete, handleMcpGet, handleMcpPost } from '@/lib/mcp/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleMcpPost(request);
}

export async function GET() {
  return handleMcpGet();
}

export async function DELETE() {
  return handleMcpDelete();
}
