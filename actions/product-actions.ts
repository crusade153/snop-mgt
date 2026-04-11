'use server'

import bigqueryClient from '@/lib/bigquery';
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { format, subDays } from 'date-fns';

export interface ProductDetailData {
  code: string;
  name: string;
  unit: string;
  umrezBox: number;
  // 판매 추이 (최근 60일, 일별)
  salesTrend: { date: string; qty: number; amount: number }[];
  // KPI
  kpi: {
    sales30Amount: number;  // 최근 30일 매출
    totalStock: number;     // 현재 총 재고
    unfulfilledQty: number; // 현재 미납 수량
    unfulfilledValue: number;
  };
  // 배치별 재고
  batches: {
    location: string;
    qty: number;
    expirationDate: string;
    remainDays: number;
    status: string;
  }[];
  // 생산 계획 vs 실적 (최근 30일)
  production: {
    date: string;
    plant: string;
    planQty: number;
    actualQty: number;
    rate: number;
  }[];
}

export async function getProductDetail(matnr: string): Promise<{ success: boolean; data?: ProductDetailData; message?: string }> {
  const today = new Date();
  const start60 = format(subDays(today, 60), 'yyyyMMdd');
  const start30 = format(subDays(today, 30), 'yyyyMMdd');
  const todayStr = format(today, 'yyyyMMdd');

  const salesQuery = `
    SELECT
      A.VDATU,
      A.ARKTX,
      IFNULL(M.MEINS, 'EA') AS MEINS,
      IFNULL(M.UMREZ_BOX, 1) as UMREZ_BOX,
      SUM(
        CASE
          WHEN A.VRKME = 'BOX' AND M.MEINS <> 'BOX' THEN A.KWMENG * IFNULL(M.UMREZ_BOX, 1)
          ELSE A.KWMENG
        END
      ) as DAY_QTY,
      SUM(A.NETWR) as DAY_AMOUNT,
      SUM(
        CASE
          WHEN A.LFIMG_LIPS IS NULL OR A.LFIMG_LIPS = 0 THEN
            CASE
              WHEN A.VRKME = 'BOX' AND M.MEINS <> 'BOX' THEN A.KWMENG * IFNULL(M.UMREZ_BOX, 1)
              ELSE A.KWMENG
            END
          ELSE 0
        END
      ) as UNFULFILLED_QTY,
      SUM(
        CASE
          WHEN A.LFIMG_LIPS IS NULL OR A.LFIMG_LIPS = 0 THEN A.NETWR
          ELSE 0
        END
      ) as UNFULFILLED_VALUE
    FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
    WHERE A.MATNR = '${matnr}'
      AND A.VDATU BETWEEN '${start60}' AND '${todayStr}'
    GROUP BY A.VDATU, A.ARKTX, M.MEINS, M.UMREZ_BOX
    ORDER BY A.VDATU ASC
  `;

  const inventoryQuery = `
    SELECT
      MATNR_T, MEINS, LGOBE,
      IFNULL(SUBSTR(REPLACE(CAST(VFDAT AS STRING), '-', ''), 1, 8), '') AS VFDAT,
      CLABS,
      IFNULL(UMREZ_BOX, 1) as UMREZ_BOX,
      remain_day
    FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB_ALL\`
    WHERE MATNR = '${matnr}'
      AND CLABS > 0
      AND LGORT NOT IN ('1110', '2141', '2143', '2240', '2243', '3000', '3300', '9000', '9100')
    ORDER BY remain_day ASC
  `;

  const productionQuery = `
    SELECT
      P.GSTRP, P.WERKS, P.MAKTX,
      SUM(CASE WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.PSMNG * IFNULL(M.UMREZ_BOX, 1) ELSE P.PSMNG END) as PSMNG,
      SUM(CASE WHEN P.MEINS = 'BOX' AND M.MEINS <> 'BOX' THEN P.LMNGA * IFNULL(M.UMREZ_BOX, 1) ELSE P.LMNGA END) as LMNGA
    FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` AS P
    LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON P.MATNR = M.MATNR
    WHERE P.MATNR = '${matnr}'
      AND P.GSTRP BETWEEN '${start30}' AND '${todayStr}'
    GROUP BY P.GSTRP, P.WERKS, P.MAKTX
    ORDER BY P.GSTRP DESC
  `;

  try {
    const [[salesRows], [invRows], [prodRows]] = await Promise.all([
      bigqueryClient.query({ query: salesQuery }),
      bigqueryClient.query({ query: inventoryQuery }),
      bigqueryClient.query({ query: productionQuery }),
    ]);

    if (!salesRows.length && !invRows.length) {
      return { success: false, message: '해당 제품 데이터를 찾을 수 없습니다.' };
    }

    const firstRow: any = salesRows[0] || invRows[0];
    const name: string = firstRow?.ARKTX || firstRow?.MATNR_T || matnr;
    const unit: string = firstRow?.MEINS || 'EA';
    const umrezBox: number = Number(firstRow?.UMREZ_BOX) || 1;

    // 판매 추이
    const salesTrend = (salesRows as any[]).map((r) => ({
      date: String(r.VDATU || ''),
      qty: Number(r.DAY_QTY) || 0,
      amount: Number(r.DAY_AMOUNT) || 0,
    }));

    // KPI 계산
    const sales30Rows = salesTrend.filter((r) => r.date >= start30);
    const sales30Amount = sales30Rows.reduce((s, r) => s + r.amount, 0);
    const totalStock = (invRows as any[]).reduce((s: number, r: any) => s + (Number(r.CLABS) || 0), 0);
    const unfulfilledQty = (salesRows as any[]).reduce((s: number, r: any) => s + (Number(r.UNFULFILLED_QTY) || 0), 0);
    const unfulfilledValue = (salesRows as any[]).reduce((s: number, r: any) => s + (Number(r.UNFULFILLED_VALUE) || 0), 0);

    // 재고 배치
    const batches = (invRows as any[]).map((r: any) => {
      const remainDays = Number(r.remain_day) || 0;
      let status = 'healthy';
      if (remainDays <= 0) status = 'disposed';
      else if (remainDays <= 30) status = 'imminent';
      else if (remainDays <= 60) status = 'critical';
      const vfdat = String(r.VFDAT || '');
      if (!vfdat || vfdat.startsWith('0000')) status = 'no_expiry';
      return {
        location: String(r.LGOBE || ''),
        qty: Number(r.CLABS) || 0,
        expirationDate: vfdat,
        remainDays,
        status,
      };
    });

    // 생산 계획 vs 실적
    const production = (prodRows as any[]).map((r: any) => {
      const plan = Number(r.PSMNG) || 0;
      const actual = Number(r.LMNGA) || 0;
      return {
        date: String(r.GSTRP || ''),
        plant: String(r.WERKS || ''),
        planQty: plan,
        actualQty: actual,
        rate: plan > 0 ? Math.round((actual / plan) * 100) : 0,
      };
    });

    return {
      success: true,
      data: {
        code: matnr,
        name,
        unit,
        umrezBox,
        salesTrend,
        kpi: { sales30Amount, totalStock, unfulfilledQty, unfulfilledValue },
        batches,
        production,
      },
    };
  } catch (e: any) {
    console.error('❌ [product-actions] Error:', e.message);
    return { success: false, message: e.message };
  }
}
