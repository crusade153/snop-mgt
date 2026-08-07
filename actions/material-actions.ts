'use server';

/**
 * 자재(원부포장재) 사실 데이터 — BigQuery 실행 + 캐시
 *
 * 이 앱은 지금까지 완제품(MATNR 5000만~6999만)만 봤다. 여기서 처음으로 자재 대역을 읽는다.
 * 소스는 자재 수급 관제탑(purchase 앱)과 같은 테이블을 쓴다 — 두 앱의 숫자가 갈리면
 * 아무도 안 믿기 때문이다.
 *
 * 쿼리문과 행 변환은 lib/material/queries.ts 에 순수 함수로 두고 여기서는 실행만 한다.
 */

import { unstable_cache } from 'next/cache';
import { gunzipSync, gzipSync } from 'zlib';
import { format, subDays, subMonths } from 'date-fns';
import bigqueryClient from '@/lib/bigquery';
import { MAX_BOM_LEVEL } from '@/lib/bom/explosion-sql';
import { buildMaterialRequirementQuery } from '@/lib/material/requirement-sql';
import {
  buildMaterialStockQuery,
  buildOpenPoQuery,
  buildProductUsageQuery,
  mergeMaterialFacts,
  toMaterialRequirements,
  toProductUsage,
  PO_OVERDUE_CUTOFF_DAYS,
  MATERIAL_SIMULATION_MONTHS,
} from '@/lib/material/queries';
import type { MaterialFact, MaterialRequirementRow, ProductUsage } from '@/types/material';

function ymd(date: Date) {
  return format(date, 'yyyyMMdd');
}

async function fetchMaterialFactsUncached(): Promise<MaterialFact[]> {
  const today = new Date();
  const [[stockRows], [poRows]] = await Promise.all([
    bigqueryClient.query({ query: buildMaterialStockQuery() }),
    bigqueryClient.query({
      query: buildOpenPoQuery(),
      params: {
        todayInt: Number(ymd(today)),
        overdueCutoff: Number(ymd(subDays(today, PO_OVERDUE_CUTOFF_DAYS))),
      },
      types: { todayInt: 'INT64', overdueCutoff: 'INT64' },
    }),
  ]);

  return mergeMaterialFacts(
    stockRows as Record<string, unknown>[],
    poRows as Record<string, unknown>[],
  );
}

export async function getMaterialFacts(): Promise<MaterialFact[]> {
  return unstable_cache(fetchMaterialFactsUncached, ['material-facts-v2-stock-status'], {
    revalidate: 600,
    tags: ['report-data'],
  })();
}

async function fetchProductUsageUncached(months: number): Promise<ProductUsage[]> {
  const today = new Date();
  const [rows] = await bigqueryClient.query({
    query: buildProductUsageQuery(),
    params: { fromDate: ymd(subMonths(today, months)), toDate: ymd(today) },
    types: { fromDate: 'STRING', toDate: 'STRING' },
  });
  return toProductUsage(rows as Record<string, unknown>[]);
}

export async function getProductUsage(months = 3): Promise<ProductUsage[]> {
  return unstable_cache(
    () => fetchProductUsageUncached(months),
    [`product-usage-v1-${months}`],
    { revalidate: 600, tags: ['report-data'] },
  )();
}

/**
 * 자재 소요량 집계 — BOM 전개 × 생산실적을 (자재 × 공장 × 제품계층) 으로 접은 것.
 *
 * ⚠️ gzip 후 캐시한다. 원·부자재까지 넓히면 이 집계가 17,881행 / 약 1.4MB 라
 *    unstable_cache 의 항목 2MB 제한에 위험하게 가깝다(넘으면 저장이 조용히 실패하고
 *    매 요청 BigQuery 를 다시 때린다). 압축 방식은 actions/dashboard-actions.ts:164-193
 *    에서 이미 쓰는 것과 같다.
 * ⚠️ 전개가 무거워(실측 11초) 캐시가 비면 그 요청은 느리다. 자재 화면이 서버
 *    렌더링이라 사용자에겐 첫 로딩으로 보인다.
 */
async function fetchMaterialRequirementsCompressed(): Promise<string> {
  const today = new Date();
  const maxMonths = MATERIAL_SIMULATION_MONTHS.at(-1) ?? 12;
  const [rows] = await bigqueryClient.query({
    query: buildMaterialRequirementQuery('RAW_AND_PACKAGING'),
    params: {
      maxLevel: MAX_BOM_LEVEL,
      plants: [],
      fromDate: ymd(subMonths(today, maxMonths)),
      toDate: ymd(today),
    },
    types: {
      maxLevel: 'INT64',
      plants: ['STRING'],
      fromDate: 'STRING',
      toDate: 'STRING',
    },
  });
  const parsed = toMaterialRequirements(rows as Record<string, unknown>[]);
  return gzipSync(JSON.stringify(parsed), { level: 9 }).toString('base64');
}

export async function getMaterialRequirements(): Promise<MaterialRequirementRow[]> {
  const compressed = await unstable_cache(
    fetchMaterialRequirementsCompressed,
    ['material-requirements-v2-3-to-12-months'],
    { revalidate: 600, tags: ['report-data'] },
  )();
  return JSON.parse(gunzipSync(Buffer.from(compressed, 'base64')).toString());
}
