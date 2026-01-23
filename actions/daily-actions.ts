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
  // 단위 변환을 위한 원본 데이터 전달
  qty: number;
  umrez: number;
  unit: string;
}

export interface DailySummary {
  scannedCount: number;
  topOrders: { name: string; qty: number; umrez: number; unit: string }[];
  lowestBalance: { name: string; balance: number; umrez: number; unit: string }[];
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
    // 1. 주문/배송 데이터 (SD) - 기준 단위(EA)로 환산하여 조회
    const sdQuery = `
      SELECT 
        A.MATNR, A.ARKTX, A.VDATU, A.KUNNR, A.NAME1,
        SUM(
          CASE 
            WHEN A.VRKME = 'BOX' THEN A.KWMENG * IFNULL(M.UMREZ_BOX, 1) 
            ELSE A.KWMENG 
          END
        ) as qty_req,
        SUM(
          CASE 
            WHEN A.VRKME = 'BOX' THEN IFNULL(A.LFIMG_LIPS, 0) * IFNULL(M.UMREZ_BOX, 1)
            ELSE IFNULL(A.LFIMG_LIPS, 0) 
          END
        ) as qty_done,
        MAX(IFNULL(M.UMREZ_BOX, 1)) as UMREZ_BOX,
        MAX(M.MEINS) as MEINS
      FROM \`harimfood-361004.harim_sap_bi.SD_ZASSDDV0020\` AS A
      LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON A.MATNR = M.MATNR
      WHERE A.VDATU BETWEEN '${adsLookbackStr}' AND '${weekFutureStr}'
      GROUP BY A.MATNR, A.ARKTX, A.VDATU, A.KUNNR, A.NAME1
    `;

    // 2. 생산 계획 데이터 (PP) - 기준 단위(EA)로 환산
    const ppQuery = `
      SELECT 
        P.MATNR, P.GSTRP,
        SUM(
          CASE 
            WHEN P.MEINS = 'BOX' THEN P.PSMNG * IFNULL(M.UMREZ_BOX, 1)
            ELSE P.PSMNG 
          END
        ) as qty_plan,
        MAX(IFNULL(M.UMREZ_BOX, 1)) as UMREZ_BOX,
        MAX(M.MEINS) as MEINS
      FROM \`harimfood-361004.harim_sap_bi.PP_ZASPPR1110\` AS P
      LEFT JOIN \`harimfood-361004.harim_sap_bi.SD_MARA\` AS M ON P.MATNR = M.MATNR
      WHERE P.GSTRP BETWEEN '${todayStr}' AND '${weekFutureStr}'
      GROUP BY P.MATNR, P.GSTRP
    `;

    // 3. 재고 데이터 (MM) - CLABS는 이미 기준 단위
    const mmQuery = `
      SELECT 
        MATNR, MATNR_T, VFDAT, 
        SUM(CLABS) as current_stock,
        MAX(remain_day) as max_remain_day,
        MAX(IFNULL(UMREZ_BOX, 1)) as UMREZ_BOX,
        MAX(MEINS) as MEINS
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
    // Data Aggregation
    // --------------------------------------------------------------------------
    interface ProductSalesInfo {
      name: string;
      yesterday: number;
      weekSum: number;
      sixtyDaySum: number;
      ads60: number;
      umrez: number;
      unit: string;
    }
    const salesMap = new Map<string, ProductSalesInfo>();

    sdRows.forEach((row: any) => {
      if(row.MATNR) scannedProducts.add(row.MATNR);
      const code = row.MATNR;
      const date = row.VDATU;
      const qty = Number(row.qty_req || 0);
      const umrez = Number(row.UMREZ_BOX || 1);
      const unit = row.MEINS || 'EA';

      if (!salesMap.has(code)) {
        salesMap.set(code, { 
          name: row.ARKTX, yesterday: 0, weekSum: 0, sixtyDaySum: 0, ads60: 0,
          umrez, unit
        });
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
          qty: val.yesterday,
          umrez: val.umrez,
          unit: val.unit
        });
      }
    });

    // --------------------------------------------------------------------------
    // [분석 2] 7일 내 결품 예상 (Shortage) - ✅ 확정된 납품 요청 기준
    // --------------------------------------------------------------------------
    const shortageMap = new Map<string, { stock: number, supply: number, demand: number, name: string, umrez: number, unit: string }>();
    
    // 1. 현재 재고
    mmRows.forEach((row: any) => {
      if(row.MATNR) scannedProducts.add(row.MATNR);
      if (!shortageMap.has(row.MATNR)) {
        shortageMap.set(row.MATNR, { 
          stock: 0, supply: 0, demand: 0, name: row.MATNR_T, 
          umrez: Number(row.UMREZ_BOX || 1), unit: row.MEINS || 'EA' 
        });
      }
      shortageMap.get(row.MATNR)!.stock += Number(row.current_stock);
    });
    
    // 2. 향후 7일 생산 계획 (입고 예정)
    ppRows.forEach((row: any) => {
      if (!shortageMap.has(row.MATNR)) {
        shortageMap.set(row.MATNR, { 
          stock: 0, supply: 0, demand: 0, name: '', 
          umrez: Number(row.UMREZ_BOX || 1), unit: row.MEINS || 'EA'
        });
      }
      shortageMap.get(row.MATNR)!.supply += Number(row.qty_plan);
    });
    
    // 3. 향후 7일 확정 납품 요청 (출고 예정)
    sdRows.forEach((row: any) => {
      // 오늘 ~ 7일 후 사이의 납품 요청만 집계 (VDATU 기준)
      if (row.VDATU >= todayStr && row.VDATU <= weekFutureStr) {
        if (!shortageMap.has(row.MATNR)) {
          shortageMap.set(row.MATNR, { 
            stock: 0, supply: 0, demand: 0, name: row.ARKTX, 
            umrez: Number(row.UMREZ_BOX || 1), unit: row.MEINS || 'EA'
          });
        }
        shortageMap.get(row.MATNR)!.demand += Number(row.qty_req);
        // 이름이 없는 경우 보완
        if (!shortageMap.get(row.MATNR)!.name) shortageMap.get(row.MATNR)!.name = row.ARKTX;
      }
    });

    shortageMap.forEach((val, code) => {
      // 잔고 = 현재재고 + 입고예정 - 확정된납품요청
      const balance = val.stock + val.supply - val.demand;
      
      if (balance < 0) {
        // 단위 포맷팅 함수 (내부용)
        const fmt = (n: number) => Math.round(n).toLocaleString();
        
        alerts.push({
          id: `short-${code}`,
          type: 'SHORTAGE',
          level: 'CRITICAL',
          productCode: code,
          productName: val.name,
          // ✅ 메시지 수정: "가정"이 아님을 명확히 표시
          message: `향후 7일간 확정된 납품 요청(${fmt(val.demand)}) 대비 재고(${fmt(val.stock + val.supply)}) 부족`,
          action: '생산 우선순위 상향 또는 분할 출고 협의',
          qty: balance, // 부족분 (음수)
          umrez: val.umrez,
          unit: val.unit
        });
      }
    });

    // --------------------------------------------------------------------------
    // [분석 3] 소진 불가 위험 (Burn-down Risk)
    // --------------------------------------------------------------------------
    const freshnessRiskMap = new Map<string, { code:string, name: string, overStock: number, totalStock: number, ads: number, minDays: number, umrez: number, unit: string }>();

    mmRows.forEach((row: any) => {
      const code = row.MATNR;
      const stock = Number(row.current_stock);
      const remainDays = Number(row.max_remain_day);
      const salesInfo = salesMap.get(code);
      const ads = salesInfo ? salesInfo.ads60 : 0;
      const umrez = Number(row.UMREZ_BOX || 1);
      const unit = row.MEINS || 'EA';

      if (stock > 0 && ads > 0) {
        const daysToSell = stock / ads; 
        if (daysToSell > remainDays) {
          const riskQty = stock - (ads * remainDays);
          if (riskQty > 5) {
            if (!freshnessRiskMap.has(code)) {
              freshnessRiskMap.set(code, { code, name: row.MATNR_T, overStock: 0, totalStock: 0, ads, minDays: remainDays, umrez, unit });
            }
            const item = freshnessRiskMap.get(code)!;
            item.overStock += riskQty;
            item.totalStock += stock;
            item.minDays = Math.min(item.minDays, remainDays); 
          }
        }
      } 
      else if (stock > 0 && ads === 0 && remainDays < 180) {
        if (!freshnessRiskMap.has(code)) {
          freshnessRiskMap.set(code, { code, name: row.MATNR_T, overStock: 0, totalStock: 0, ads: 0, minDays: remainDays, umrez, unit });
        }
        const item = freshnessRiskMap.get(code)!;
        item.overStock += stock; 
        item.totalStock += stock;
        item.minDays = Math.min(item.minDays, remainDays);
      }
    });

    freshnessRiskMap.forEach((val) => {
      if (val.ads > 0) {
        alerts.push({
          id: `burn-${val.code}`,
          type: 'FRESHNESS',
          level: 'CRITICAL',
          productCode: val.code,
          productName: val.name,
          message: `판매 속도(${val.ads.toFixed(1)}/일) 대비 유통기한 부족 (잔여 ${val.minDays}일)`,
          action: '소비기한 내 소진 불가. 긴급 프로모션 필요',
          qty: val.overStock,
          umrez: val.umrez,
          unit: val.unit
        });
      } else {
        alerts.push({
          id: `dead-${val.code}`,
          type: 'FRESHNESS',
          level: 'CRITICAL',
          productCode: val.code,
          productName: val.name,
          message: `최근 60일간 판매 이력 없음 (유통기한 ${val.minDays}일 남음)`,
          action: '긴급 판로 개척 또는 기부/폐기 의사결정 필요',
          qty: val.totalStock,
          umrez: val.umrez,
          unit: val.unit
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
            qty: miss,
            umrez: Number(row.UMREZ_BOX || 1),
            unit: row.MEINS || 'EA'
          });
        }
      }
    });

    alerts.sort((a, b) => (a.level === 'CRITICAL' ? -1 : 1));

    // 요약 정보
    const topOrders = Array.from(salesMap.values())
      .filter(item => item.yesterday > 0)
      .sort((a, b) => b.yesterday - a.yesterday)
      .slice(0, 3)
      .map(item => ({ 
        name: item.name, 
        qty: item.yesterday,
        umrez: item.umrez,
        unit: item.unit
      }));

    const lowestBalance = Array.from(shortageMap.values())
      .map(item => ({ 
        name: item.name, 
        balance: item.stock + item.supply - item.demand,
        umrez: item.umrez,
        unit: item.unit
      }))
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