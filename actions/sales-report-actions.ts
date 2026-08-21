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
  buildSalesReportParams,
  buildSalesReportQuery,
  isIsoDate,
  previousYearRange,
  type SalesRawRow,
  type SalesReportParams,
  type SalesVtweg,
} from '@/lib/sales-report/query';

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

  return { ok: true, params: { from, to, vtweg, channel } };
}

async function runSalesReport(params: SalesReportParams): Promise<SalesReportBoard> {
  const [rows] = await bigqueryClient.query({
    query: buildSalesReportQuery(),
    params: buildSalesReportParams(params),
  });

  return buildSalesBoard(rows as SalesRawRow[], params);
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
      params: { from: '', to: '', vtweg: 'ALL', channel: '' },
      previous: { from: '', to: '' },
      board: null,
      fetchedAt,
    };
  }

  const { params } = checked;
  const cacheKey = [
    // v2: 월 추이를 당기·전년 각자의 구간에서 집계하도록 고침(부분월이 한 달치로 부풀던 문제) +
    //     제품 표를 자재코드로만 묶음(한 코드에 이름이 여러 개라 줄이 쪼개지던 문제).
    'sales-report-v2',
    params.from,
    params.to,
    params.vtweg,
    params.channel || 'ALLCH',
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
