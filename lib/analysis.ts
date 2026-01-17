import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { IntegratedItem, DashboardAnalysis, InventoryBatch, CustomerStat } from '@/types/analysis';
import { differenceInCalendarDays, parseISO } from 'date-fns';

const THRESHOLDS = {
  CRITICAL_DAYS: 30, // 30일 이하 긴급
  SAFETY_BUFFER_DAYS: 14, // 적정 재고 기준 (2주치)
};

// 판매 속도(ADS) 계산
function calculateSalesVelocity(orders: SapOrder[], days: number): Map<string, number> {
  const map = new Map<string, number>();
  const safeDays = Math.max(1, days); // 0으로 나누기 방지

  orders.forEach(row => {
    if (!row.MATNR) return;
    const qty = Number(row.LFIMG_LIPS ?? row.KWMENG ?? 0);
    if (qty > 0) map.set(row.MATNR, (map.get(row.MATNR) || 0) + qty);
  });

  for (const [key, total] of map.entries()) {
    map.set(key, total / safeDays);
  }
  return map;
}

// 재고 상태 판별
function getStockStatus(days: number): 'disposed' | 'critical' | 'healthy' {
  if (days <= 0) return 'disposed';
  if (days <= THRESHOLDS.CRITICAL_DAYS) return 'critical';
  return 'healthy';
}

export function analyzeSnopData(
  orders: SapOrder[],
  inventoryList: SapInventory[],
  productionList: SapProduction[],
  startDateStr: string,
  endDateStr: string
): DashboardAnalysis {
  
  // 조회 기간 자동 계산 (기본값 방어)
  let daysDiff = 60;
  try {
    if (startDateStr && endDateStr) {
      daysDiff = differenceInCalendarDays(parseISO(endDateStr), parseISO(startDateStr)) + 1;
    }
  } catch (e) {
    console.error("Date parsing error:", e);
  }

  const velocityMap = calculateSalesVelocity(orders, daysDiff);
  
  // 🔄 [재고 집계] 품목별로 배치를 모으는 로직
  const invAggMap = new Map<string, { totalStock: number, batches: InventoryBatch[], info: SapInventory }>();
  
  inventoryList.forEach(inv => {
    if (!invAggMap.has(inv.MATNR)) {
      invAggMap.set(inv.MATNR, { totalStock: 0, batches: [], info: inv });
    }
    const target = invAggMap.get(inv.MATNR)!;
    
    // 수량 합산
    target.totalStock += Number(inv.CLABS || 0);
    
    // 배치 정보 추가 (유통기한별 + 잔여율 포함)
    target.batches.push({
      quantity: Number(inv.CLABS || 0),
      expirationDate: inv.VFDAT || '',
      remainDays: Number(inv.remain_day || 0),
      remainRate: Number(inv.remain_rate || 0), // 🆕 DB 값 연결
      location: inv.LGOBE || ''
    });
  });

  const integratedMap = new Map<string, IntegratedItem>();
  const customerMap = new Map<string, CustomerStat>();
  let productSales = 0;
  let merchandiseSales = 0;
  const today = new Date();

  // 1. 주문 데이터 처리
  orders.forEach(order => {
    const code = order.MATNR;
    if (!code) return;

    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, order.ARKTX, invAggMap, velocityMap, order.VRKME);
    }
    const item = integratedMap.get(code)!;

    const supplyPrice = Number(order.NETWR || 0);
    const reqQty = Number(order.KWMENG || 0);
    const actualQty = Number(order.LFIMG_LIPS || 0);
    const unfulfilled = Math.max(0, reqQty - actualQty);

    item.totalReqQty += reqQty;
    item.totalActualQty += actualQty;
    item.totalSalesAmount += supplyPrice;

    if (code.startsWith('5')) productSales += supplyPrice;
    else merchandiseSales += supplyPrice;

    if (unfulfilled > 0) {
        item.totalUnfulfilledQty += unfulfilled;
        const unitPrice = reqQty > 0 ? (supplyPrice / reqQty) : 0;
        item.totalUnfulfilledValue += unfulfilled * unitPrice;

        // 미납 원인 추정
        let cause = '기타';
        // (단순 비교: 총 재고가 미납량보다 많으면 물류 이슈, 아니면 재고 부족)
        if (item.inventory.totalStock >= unfulfilled) cause = '물류/출하 지연';
        else cause = '재고 부족';

        let daysDelayed = 0;
        if (order.VDATU && order.VDATU.length === 8) {
            try {
                const dateStr = `${order.VDATU.slice(0, 4)}-${order.VDATU.slice(4, 6)}-${order.VDATU.slice(6, 8)}`;
                daysDelayed = differenceInCalendarDays(today, parseISO(dateStr));
            } catch(e) {}
        }

        item.unfulfilledOrders.push({
            place: order.NAME1 || '알수없음',
            qty: unfulfilled,
            value: unfulfilled * unitPrice,
            unitPrice,
            reqDate: order.VDATU,
            daysDelayed,
            cause
        });
    }

    // 거래처 통계
    const custId = order.KUNNR || 'UNKNOWN';
    if (!customerMap.has(custId)) {
        customerMap.set(custId, {
            id: custId, name: order.NAME1 || '알수없음',
            orderCount: 0, fulfilledCount: 0, totalRevenue: 0, missedRevenue: 0, fulfillmentRate: 0
        });
    }
    const cust = customerMap.get(custId)!;
    cust.orderCount++;
    cust.totalRevenue += supplyPrice;

    if (unfulfilled <= 0) cust.fulfilledCount++;
    else {
        const unitPrice = reqQty > 0 ? (supplyPrice / reqQty) : 0;
        cust.missedRevenue += unfulfilled * unitPrice;
    }
  });

  // 2. 생산 데이터 처리
  productionList.forEach(prod => {
    const code = prod.MATNR;
    if (!integratedMap.has(code)) initializeItem(integratedMap, code, prod.MAKTX, invAggMap, velocityMap, prod.MEINS);
    const item = integratedMap.get(code)!;
    item.production.planQty += Number(prod.PSMNG || 0);
    item.production.receivedQty += Number(prod.LMNGA || 0);
  });

  // 3. 재고 데이터 Backfill (주문/생산 없는 품목)
  invAggMap.forEach((val, key) => {
    if (!integratedMap.has(key)) {
      initializeItem(integratedMap, key, val.info.MATNR_T, invAggMap, velocityMap, val.info.MEINS);
    }
  });

  // 4. 최종 KPI 계산
  const integratedArray = Array.from(integratedMap.values());
  let totalUnfulfilledValue = 0;
  let criticalDeliveryCount = 0;
  const stockHealth = { disposed: 0, critical: 0, healthy: 0 };
  const salesByBrand: Record<string, number> = {};
  const salesByCategory: Record<string, number> = {};
  const salesByFamily: Record<string, number> = {};

  integratedArray.forEach(item => {
    if (item.production.planQty > 0) {
        item.production.achievementRate = (item.production.receivedQty / item.production.planQty) * 100;
    }
    totalUnfulfilledValue += item.totalUnfulfilledValue;
    if (item.unfulfilledOrders.some(o => o.daysDelayed >= 7)) criticalDeliveryCount++;

    // 재고 상태 카운트 (대표 상태 기준)
    if (item.inventory.totalStock > 0) {
        if (item.inventory.status === 'disposed') stockHealth.disposed++;
        else if (item.inventory.status === 'critical') stockHealth.critical++;
        else stockHealth.healthy++;
    }

    if (item.totalSalesAmount > 0) {
        const brand = item.brand || '기타';
        salesByBrand[brand] = (salesByBrand[brand] || 0) + item.totalSalesAmount;
        const cat = item.category || '미지정';
        salesByCategory[cat] = (salesByCategory[cat] || 0) + item.totalSalesAmount;
    }
  });

  const customerStats = Array.from(customerMap.values()).map(c => {
      c.fulfillmentRate = c.orderCount > 0 ? (c.fulfilledCount / c.orderCount) * 100 : 0;
      return c;
  }).sort((a, b) => b.missedRevenue - a.missedRevenue);

  const fulfillmentSummary = {
      totalOrders: orders.length,
      fulfilledOrders: customerStats.reduce((acc, c) => acc + c.fulfilledCount, 0),
      unfulfilledCount: orders.length - customerStats.reduce((acc, c) => acc + c.fulfilledCount, 0),
      totalCustomers: customerStats.length,
      averageRate: 0
  };

  const toSortedArray = (obj: Record<string, number>) => 
    Object.entries(obj).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return {
    kpis: {
      productSales,
      merchandiseSales,
      overallFulfillmentRate: '0.0',
      totalUnfulfilledValue,
      criticalDeliveryCount
    },
    stockHealth,
    salesAnalysis: {
      byBrand: toSortedArray(salesByBrand),
      byCategory: toSortedArray(salesByCategory),
      byFamily: toSortedArray(salesByFamily)
    },
    integratedArray,
    fulfillment: { summary: fulfillmentSummary, byCustomer: customerStats }
  };
}

// 🔧 초기화 함수: 재고 Map 구조 변경(invAggMap)에 맞춰 수정됨
function initializeItem(
  map: Map<string, IntegratedItem>,
  code: string,
  nameHint: string,
  invMap: Map<string, { totalStock: number, batches: InventoryBatch[], info: SapInventory }>,
  velocityMap: Map<string, number>,
  unit: string
) {
  const invData = invMap.get(code);
  const ads = velocityMap.get(code) || 0;
  const recStock = Math.ceil(ads * THRESHOLDS.SAFETY_BUFFER_DAYS);
  
  // 대표 상태 판별 (가장 유통기한 짧은 배치 기준)
  let minRemaining = 9999;
  if (invData && invData.batches.length > 0) {
    minRemaining = Math.min(...invData.batches.map(b => b.remainDays));
  } else if (invData && invData.info.remain_day !== undefined) {
    minRemaining = Number(invData.info.remain_day);
  }

  const status = invData ? getStockStatus(minRemaining) : 'healthy';
  const riskScore = status === 'critical' ? 100 : (status === 'disposed' ? 50 : 0);

  // 분류 로직 (임시)
  const brand = '하림'; 
  const category = '상온'; 
  const family = '즉석밥';

  map.set(code, {
    code,
    name: nameHint || invData?.info.MATNR_T || '',
    unit: unit || invData?.info.MEINS || 'EA',
    brand, category, family,
    totalReqQty: 0, totalActualQty: 0, totalUnfulfilledQty: 0, totalUnfulfilledValue: 0, totalSalesAmount: 0,
    inventory: {
      totalStock: invData?.totalStock || 0,
      usableStock: invData?.totalStock || 0, // 기본적으로 전체를 가용 재고로 시작
      batches: invData?.batches || [],       // 👈 배치 리스트 주입
      status,
      remainingDays: minRemaining === 9999 ? 0 : minRemaining,
      riskScore,
      ads,
      recommendedStock: recStock
    },
    production: {
      planQty: 0, receivedQty: 0, achievementRate: 0, lastReceivedDate: null
    },
    unfulfilledOrders: []
  });
}