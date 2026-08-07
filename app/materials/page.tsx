import { getMaterialInsights } from '@/actions/material-insight-actions';
import MaterialsClient from './materials-client';

export const dynamic = 'force-dynamic';
// 소요량 집계는 BOM 전개를 포함해 캐시가 비면 10초 넘게 걸린다(10분 캐시).
export const maxDuration = 60;

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; scope?: string; search?: string }>;
}) {
  const params = await searchParams;
  const scope = params.scope === 'ALL' ? 'ALL' : params.scope === 'MINE' ? 'MINE' : undefined;

  // 제품 상세에서 자재코드를 들고 넘어오는 경로가 있다. 그때는 전체 범위로 열어야
  // 남의 담당 자재라도 찾을 수 있다.
  const payload = await getMaterialInsights({
    ownerId: params.owner,
    scope: params.search ? 'ALL' : scope,
  });

  return (
    <MaterialsClient
      payload={payload}
      activeOwnerId={params.owner ?? null}
      initialSearch={params.search ?? ''}
    />
  );
}
