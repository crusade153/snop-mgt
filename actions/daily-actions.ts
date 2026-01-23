'use server'

import bigqueryClient from '@/lib/bigquery';
import { addDays, subDays, format, parseISO } from 'date-fns';

export interface DailyAlertItem {
  id: string;
  type: 'SPIKE' | 'SHORTAGE' | 'FRESHNESS' | 'MISS';
  level: 'CRITICAL' | 'WARNING';
  productCode: string;
  productName: string;
  message: string;
  action: string;
  value: string;
}

export interface DailySummary {
  scannedCount: number;
  topOrders: { name: string; qty: number }[];
  lowestBalance: { name: string; balance: number }[];
}

export async function getDailyWatchReport(targetDateStr?: string): Promise<{ success: boolean; data: DailyAlertItem[]; summary: DailySummary; runTime: string }> {
  
  const today = targetDateStr ? parseISO(targetDateStr) : new Date();
  const runTime = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

  const todayStr = format(today, 'yyyyMMdd');
  const yesterdayStr = format(subDays(today, 1), 'yyyyMMdd');
  const weekFutureStr = format(addDays(today, 7), 'yyyyMMdd');
  const adsLookbackStr = format(subDays(today, 60), 'yyyyMMdd'); 
  const spikeLookbackStr = format(subDays(today, 8), 'yyyyMMdd');

  try {
    // 1. 주문/배송 데이터 (60일치 조회)
    // 0 나누기 방지 적용 (NULLIF)
    const sdQuery = `
      SELECT 
        A.MATNR, A.ARKTX, A.VDATU, A.KUNNR, A.NAME1,
        SUM(CASE WHEN A.VRKME = 'BOX' THEN A.KWMENG ELSE A.KWMENG / IFNULL(NULLIF(M.UMREZ_BOX, 0), 1) END) as qty_req,
        SUM(CASE WHEN A.VRKME = 'BOX' THEN IFNULL(A.LFIMG_LIPS, 0) ELSE IFNULL(A.LFIMG_LIPS, 0) / IFNULL(NULLIF(M.UMREZ_BOX, 0), 1) END) as qty_done
      FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
      LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
      WHERE A.VDATU BETWEEN '${adsLookbackStr}' AND '${weekFutureStr}'
      GROUP BY A.MATNR, A.ARKTX, A.VDATU, A.KUNNR, A.NAME1
    `;

    // 2. 생산 계획 데이터
    const ppQuery = `
      SELECT 
        P.MATNR, P.GSTRP,
        SUM(CASE WHEN P.MEINS = 'BOX' THEN P.PSMNG ELSE P.PSMNG / IFNULL(NULLIF(M.UMREZ_BOX, 0), 1) END) as qty_plan
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` AS P
      LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON P.MATNR = M.MATNR
      WHERE P.GSTRP BETWEEN '${todayStr}' AND '${weekFutureStr}'
      GROUP BY P.MATNR, P.GSTRP
    `;

    // 3. 재고 데이터
    const mmQuery = `
      SELECT 
        MATNR, MATNR_T, VFDAT, 
        SUM(CLABS) as current_stock,
        MAX(remain_day) as max_remain_day
      FROM \`harimfood-361004.harim_sap_bi_user.V_MM_MCHB\`
      WHERE CLABS > 0
      GROUP BY MATNR, MATNR_T, VFDAT
    `;

    const [sdRows, ppRows, mmRows] = await Promise.all([
      bigqueryClient.query({ query: sdQuery }).then(r => r[0]),
      bigqueryClient.query({ query: ppQuery }).then(r => r[0]),
      bigqueryClient.query({ query: mmQuery }).then(r => r[0]),
    ]);

    const alerts: DailyAlertItem[] = [];
    const scannedProducts = new Set<string>(); 

    // --------------------------------------------------------------------------
    // Data Aggregation (판매 데이터 집계)
    // --------------------------------------------------------------------------
    interface ProductSalesInfo {
      name: string;
      yesterday: number;
      weekSum: number;
      sixtyDaySum: number;
      ads60: number;
    }
    const salesMap = new Map<string, ProductSalesInfo>();

    sdRows.forEach((row: any) => {
      if(row.MATNR) scannedProducts.add(row.MATNR);
      const code = row.MATNR;
      const date = row.VDATU;
      const qty = Number(row.qty_req || 0);

      if (!salesMap.has(code)) {
        salesMap.set(code, { name: row.ARKTX, yesterday: 0, weekSum: 0, sixtyDaySum: 0, ads60: 0 });
      }
      const data = salesMap.get(code)!;

      if (date === yesterdayStr) data.yesterday += qty;
      if (date >= spikeLookbackStr && date < yesterdayStr) data.weekSum += qty;
      if (date >= adsLookbackStr && date <= yesterdayStr) data.sixtyDaySum += qty;
    });

    salesMap.forEach(val => {
      val.ads60 = val.sixtyDaySum / 60; 
    });

    // --------------------------------------------------------------------------
    // [분석 1] 어제 주문 급증 (Yesterday Spike)
    // --------------------------------------------------------------------------
    salesMap.forEach((val, code) => {
      const weekAvg = val.weekSum / 7; 
      if (val.yesterday > 30 && val.yesterday > weekAvg * 2.0) {
        alerts.push({
          id: `spike-${code}`,
          type: 'SPIKE',
          level: 'WARNING',
          productCode: code,
          productName: val.name,
          message: `전주 평균 대비 주문량 ${(weekAvg === 0 ? 999 : ((val.yesterday - weekAvg) / weekAvg) * 100).toFixed(0)}% 폭증`,
          action: '일시적 행사 물량인지 영업팀 확인 필요',
          value: `${Math.round(val.yesterday).toLocaleString()} Box`
        });
      }
    });

    // --------------------------------------------------------------------------
    // [분석 2] 7일 내 결품 예상 (Shortage)
    // --------------------------------------------------------------------------
    const shortageMap = new Map<string, { stock: number, supply: number, demand: number, name: string }>();
    
    mmRows.forEach((row: any) => {
      if(row.MATNR) scannedProducts.add(row.MATNR);
      // 재고는 배치가 여러개일 수 있으므로 누적
      if (!shortageMap.has(row.MATNR)) shortageMap.set(row.MATNR, { stock: 0, supply: 0, demand: 0, name: row.MATNR_T });
      shortageMap.get(row.MATNR)!.stock += Number(row.current_stock);
    });
    
    ppRows.forEach((row: any) => {
      if (!shortageMap.has(row.MATNR)) shortageMap.set(row.MATNR, { stock: 0, supply: 0, demand: 0, name: '' });
      shortageMap.get(row.MATNR)!.supply += Number(row.qty_plan);
    });
    
    sdRows.forEach((row: any) => {
      if (row.VDATU >= todayStr && row.VDATU <= weekFutureStr) {
        if (!shortageMap.has(row.MATNR)) shortageMap.set(row.MATNR, { stock: 0, supply: 0, demand: 0, name: row.ARKTX });
        shortageMap.get(row.MATNR)!.demand += Number(row.qty_req);
        if (!shortageMap.get(row.MATNR)!.name) shortageMap.get(row.MATNR)!.name = row.ARKTX;
      }
    });

    shortageMap.forEach((val, code) => {
      const balance = val.stock + val.supply - val.demand;
      if (balance < 0) {
        alerts.push({
          id: `short-${code}`,
          type: 'SHORTAGE',
          level: 'CRITICAL',
          productCode: code,
          productName: val.name,
          message: `7일 내 대량 출고로 재고 고갈 예상`,
          action: '생산 우선순위 상향 또는 분할 출고 협의',
          value: `${Math.round(balance).toLocaleString()} Box`
        });
      }
    });

    // --------------------------------------------------------------------------
    // [분석 3] 소진 불가 위험 (Burn-down Risk) - 🚨 집계 로직 적용 (중복 방지)
    // --------------------------------------------------------------------------
    const freshnessRiskMap = new Map<string, { code:string, name: string, overStock: number, totalStock: number, ads: number, minDays: number }>();

    mmRows.forEach((row: any) => {
      const code = row.MATNR;
      const stock = Number(row.current_stock);
      const remainDays = Number(row.max_remain_day);
      const salesInfo = salesMap.get(code);
      const ads = salesInfo ? salesInfo.ads60 : 0;

      // Case 1: 판매 속도 대비 유통기한 부족
      if (stock > 0 && ads > 0) {
        const daysToSell = stock / ads; 
        if (daysToSell > remainDays) {
          const riskQty = stock - (ads * remainDays);
          if (riskQty > 5) {
            if (!freshnessRiskMap.has(code)) {
              freshnessRiskMap.set(code, { code, name: row.MATNR_T, overStock: 0, totalStock: 0, ads, minDays: remainDays });
            }
            const item = freshnessRiskMap.get(code)!;
            item.overStock += riskQty;
            item.totalStock += stock;
            item.minDays = Math.min(item.minDays, remainDays); // 가장 급한 유통기한
          }
        }
      } 
      // Case 2: 악성 재고 (ADS = 0)
      else if (stock > 0 && ads === 0 && remainDays < 180) {
        if (!freshnessRiskMap.has(code)) {
          freshnessRiskMap.set(code, { code, name: row.MATNR_T, overStock: 0, totalStock: 0, ads: 0, minDays: remainDays });
        }
        const item = freshnessRiskMap.get(code)!;
        item.overStock += stock; // 전체가 리스크
        item.totalStock += stock;
        item.minDays = Math.min(item.minDays, remainDays);
      }
    });

    // 집계된 리스크를 Alert로 변환
    freshnessRiskMap.forEach((val) => {
      if (val.ads > 0) {
        // Case 1 메시지
        alerts.push({
          id: `burn-${val.code}`, // Product Code 기준으로 유니크
          type: 'FRESHNESS',
          level: 'CRITICAL',
          productCode: val.code,
          productName: val.name,
          message: `판매 속도(${val.ads.toFixed(1)}/일) 대비 유통기한 부족 (잔여 ${val.minDays}일)`,
          action: '소비기한 내 소진 불가. 긴급 프로모션 필요',
          value: `폐기예상 ${Math.round(val.overStock).toLocaleString()} Box`
        });
      } else {
        // Case 2 메시지
        alerts.push({
          id: `dead-${val.code}`,
          type: 'FRESHNESS',
          level: 'CRITICAL',
          productCode: val.code,
          productName: val.name,
          message: `최근 60일간 판매 이력 없음 (유통기한 ${val.minDays}일 남음)`,
          action: '긴급 판로 개척 또는 기부/폐기 의사결정 필요',
          value: `악성재고 ${Math.round(val.totalStock).toLocaleString()} Box`
        });
      }
    });

    // --------------------------------------------------------------------------
    // [분석 4] 어제 미납 발생 (Yesterday Miss)
    // --------------------------------------------------------------------------
    sdRows.forEach((row: any) => {
      if (row.VDATU === yesterdayStr) {
        const miss = Number(row.qty_req) - Number(row.qty_done);
        if (miss > 0) {
           alerts.push({
            id: `miss-${row.MATNR}-${row.KUNNR}`,
            type: 'MISS',
            level: 'WARNING',
            productCode: row.MATNR,
            productName: row.ARKTX,
            message: `어제 출고 예정분 미납 발생 (${row.NAME1})`,
            action: '미납 사유 파악 및 금일 긴급 배차',
            value: `${Math.round(miss).toLocaleString()} Box`
          });
        }
      }
    });

    // 우선순위 정렬
    alerts.sort((a, b) => (a.level === 'CRITICAL' ? -1 : 1));

    // 요약 정보
    const topOrders = Array.from(salesMap.values())
      .filter(item => item.yesterday > 0)
      .sort((a, b) => b.yesterday - a.yesterday)
      .slice(0, 3)
      .map(item => ({ name: item.name, qty: item.yesterday }));

    const lowestBalance = Array.from(shortageMap.values())
      .map(item => ({ name: item.name, balance: item.stock + item.supply - item.demand }))
      .sort((a, b) => a.balance - b.balance)
      .slice(0, 3);

    const summary: DailySummary = {
      scannedCount: scannedProducts.size,
      topOrders,
      lowestBalance
    };

    return { success: true, data: alerts, summary, runTime };

  } catch (error: any) {
    console.error("Daily Watch Error:", error);
    return { 
      success: false, 
      data: [], 
      summary: { scannedCount: 0, topOrders: [], lowestBalance: [] }, 
      runTime 
    };
  }
}