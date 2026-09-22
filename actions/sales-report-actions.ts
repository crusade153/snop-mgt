'use server';

/**
 * 매출 리포트 조회
 *
 * 여기에는 **실행과 캐시만** 둔다. SQL 생성·집계·판정은 전부 `lib/sales-report/` 순수 함수에 있다
 * (검증 스크립트가 Next 런타임 밖에서 그 모듈을 그대로 불러 돌릴 수 있어야 하기 때문이다).
 */

import { unstable_cache } from 'next/cache';
import bigqueryClient from '@/lib/bigquery';
import { buildSalesBoard, type SalesReportBoard } from '@/lib/sales-report/board';
import {
  buildSalesDispoMasterQuery,
  buildSalesReportParams,
  buildSalesReportQuery,
  isIsoDate,
  previousYearRange,
  SALES_SCOPE_KEYS,
  type SalesProductScope,
  type SalesRawRow,
  type SalesReportParams,
  type SalesVtweg,
} from '@/lib/sales-report/query';
import {
  buildSalesMasterMaps,
  type SalesDispoRow,
  type SalesHierarchyRow,
} from '@/lib/sales-report/segment';
// 채널 판정의 원천은 `/weekly` 와 **같은 마스터 쿼리**다. 여기서 비슷한 쿼리를 새로 쓰면
// 두 화면의 B2C·B2B 가 서로 다른 자재를 가리키게 된다.
// (팀 쪽은 재고 없이 팔린 SKU 까지 받아야 해서 전용 쿼리를 쓴다 — buildSalesDispoMasterQuery 주석 참고.)
import { buildMaterialHierarchyQuery } from '@/lib/weekly/queries';

export interface SalesReportPayload {
  success: boolean;
  message?: string;
  /** 실제로 조회에 쓰인 값. 화면이 요청과 응답을 대조할 수 있게 그대로 돌려준다. */
  params: SalesReportParams;
  /** 전년 동기 구간 — 화면의 비교 라벨에 쓴다 */
  previous: { from: string; to: string };
  board: SalesReportBoard | null;
  /** 조회 시각(ISO). 캐시가 10분이라 "언제 값인가"를 화면에 노출한다. */
  fetchedAt: string;
}

const VTWEG_VALUES: SalesVtweg[] = ['ALL', '10', '20'];

/** 화면에서 온 값을 그대로 믿지 않는다. 날짜·코드가 어긋나면 조회 자체를 하지 않는다. */
function normalize(input: SalesReportParams): { ok: true; params: SalesReportParams } | { ok: false; message: string } {
  const from = String(input.from ?? '');
  const to = String(input.to ?? '');

  if (!isIsoDate(from) || !isIsoDate(to)) {
    return { ok: false, message: '조회 기간 형식이 올바르지 않습니다 (yyyy-MM-dd).' };
  }
  if (from > to) {
    return { ok: false, message: '시작일이 종료일보다 뒤입니다.' };
  }

  const vtweg = VTWEG_VALUES.includes(input.vtweg) ? input.vtweg : 'ALL';
  // 채널명은 자유 문자열이라 길이만 막는다. 값 자체는 파라미터 바인딩으로 넘어간다.
  const channel = String(input.channel ?? '').slice(0, 60);
  const scope: SalesProductScope = SALES_SCOPE_KEYS.includes(input.scope) ? input.scope : 'ALL';

  return { ok: true, params: { from, to, vtweg, channel, scope } };
}

/**
 * 조회 한 번 = BigQuery 3방.
 *
 * 매출 원장은 여전히 **한 번만** 스캔한다(SD_SO 는 2.5GB 라 축마다 쪼개면 그만큼 비용이 붙는다).
 * 나머지 둘은 팀·채널 판정에 쓰는 자재 마스터인데 SD_SO 에 없는 값이라 따로 읽는다 —
 * 실측 드라이런 기준 자재마스터 쪽 합이 1MB 미만이라 비용은 사실상 0 이고,
 * 세 결과가 같은 캐시 항목 안에 들어간다.
 */
async function runSalesReport(params: SalesReportParams): Promise<SalesReportBoard> {
  const [[rows], [dispoRows], [hierarchyRows]] = await Promise.all([
    bigqueryClient.query({
      query: buildSalesReportQuery(),
      params: buildSalesReportParams(params),
    }),
    bigqueryClient.query({ query: buildSalesDispoMasterQuery() }),
    bigqueryClient.query({ query: buildMaterialHierarchyQuery() }),
  ]);

  const master = buildSalesMasterMaps(dispoRows as SalesDispoRow[], hierarchyRows as SalesHierarchyRow[]);
  return buildSalesBoard(rows as SalesRawRow[], params, master);
}

/**
 * 캐시 키에 버전 문자열이 박혀 있다. **집계 결과가 바뀌는 수정을 했으면 v 를 올려야** 캐시가 갈린다.
 *
 * 결과 크기는 제품 1,500행이 상한이라 항목당 2MB 제한에 한참 못 미친다(실측 수백 KB).
 * 그래서 대시보드 분석처럼 gzip 으로 싸지 않는다 — 상한을 올리게 되면 그때 gzip 패턴을 따를 것.
 */
export async function getSalesReport(input: SalesReportParams): Promise<SalesReportPayload> {
  const checked = normalize(input);
  const fetchedAt = new Date().toISOString();

  if (!checked.ok) {
    return {
      success: false,
      message: checked.message,
      params: { from: '', to: '', vtweg: 'ALL', channel: '', scope: 'ALL' },
      previous: { from: '', to: '' },
      board: null,
      fetchedAt,
    };
  }

  const { params } = checked;
  const cacheKey = [
    // v3: 제품 구분(완제품/상품/기타) 필터 + 팀·채널 축을 추가하면서 집계 결과 자체가 바뀌었다.
    //     (v2: 월 추이를 당기·전년 각자의 구간에서 집계 + 제품 표를 자재코드로만 묶음)
    'sales-report-v3',
    params.from,
    params.to,
    params.vtweg,
    params.channel || 'ALLCH',
    params.scope,
  ].join('-');

  try {
    const board = await unstable_cache(() => runSalesReport(params), [cacheKey], {
      revalidate: 600,
      tags: ['report-data'],
    })();

    return {
      success: true,
      params,
      previous: previousYearRange(params.from, params.to),
      board,
      fetchedAt,
    };
  } catch (error) {
    console.error('[sales-report] 조회 실패', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '매출 리포트를 불러오지 못했습니다.',
      params,
      previous: previousYearRange(params.from, params.to),
      board: null,
      fetchedAt,
    };
  }
}
