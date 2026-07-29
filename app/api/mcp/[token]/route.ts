/**
 * MCP 엔드포인트 — URL 경로 인증용
 *
 * URL : https://<배포도메인>/api/mcp/<MCP_TOKEN>
 *
 * Claude 웹/데스크톱의 "커스텀 커넥터" 등록 폼은 URL 한 칸만 받고 헤더를 넣을 수 없어서,
 * 토큰을 경로에 담아 그대로 붙여넣을 수 있게 한 통로다.
 * 토큰이 서버 접근로그·브라우저 기록에 남으므로 이 URL 자체를 비밀번호처럼 다뤄야 한다.
 */

import { NextRequest } from 'next/server';
import { handleMcpDelete, handleMcpGet, handleMcpPost } from '@/lib/mcp/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { token } = await params;
  return handleMcpPost(request, token);
}

export async function GET() {
  return handleMcpGet();
}

export async function DELETE() {
  return handleMcpDelete();
}
