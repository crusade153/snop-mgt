import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { IntegratedItem, DashboardAnalysis, UnfulfilledOrder, CustomerStat } from '@/types/analysis';
import { differenceInCalendarDays, parseISO } from 'date-fns';

const THRESHOLDS = {
  CRITICAL_DAYS: 30, // 30일 이하 긴급
  VELOCITY_DAYS: 60,
  SAFETY_BUFFER_DAYS: 14,
};

// ADS(일평균 판매량) 계산 시 실적 기준
function calculateSalesVelocity(orders: SapOrder[], days: number = 60): Map<string, number> {
  const map = new Map<string, number>();
  orders.forEach(row => {
    if (!row.MATNR) return;
    // LFIMG_LIPS(실납품)가 있으면 쓰고, 없으면 KWMENG(주문) 사용
    const qty = Number(row.LFIMG_LIPS ?? row.KWMENG ?? 0);
    if (qty > 0) map.set(row.MATNR, (map.get(row.MATNR) || 0) + qty);
  });
  for (const [key, total] of map.entries()) map.set(key, total / days);
  return map;
}

// 재고 상태 판별 로직 복구
function getStockStatus(days: number): 'disposed' | 'critical' | 'healthy' {
  if (days <= 0) return 'disposed';
  if (days <= THRESHOLDS.CRITICAL_DAYS) return 'critical';
  return 'healthy';
}

export function analyzeSnopData(
  orders: SapOrder[],
  inventoryList: SapInventory[],
  productionList: SapProduction[]
): DashboardAnalysis {
  
  const integratedMap = new Map<string, IntegratedItem>();
  const velocityMap = calculateSalesVelocity(orders, THRESHOLDS.VELOCITY_DAYS);
  const invMap = new Map<string, SapInventory>();
  
  // 재고 맵 생성
  inventoryList.forEach(inv => invMap.set(inv.MATNR, inv));

  const customerMap = new Map<string, CustomerStat>();
  let productSales = 0;
  let merchandiseSales = 0;
  const today = new Date();

  // 1. 주문 데이터 루프
  orders.forEach(order => {
    const code = order.MATNR;
    if (!code) return;

    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, order.ARKTX, invMap, velocityMap, order.VRKME);
    }
    const item = integratedMap.get(code)!;

    const supplyPrice = Number(order.NETWR || 0);
    const reqQty = Number(order.KWMENG || 0);
    const actualQty = Number(order.LFIMG_LIPS || 0);
    
    // 미납 수량 = 주문 - 실납품 (음수 방지)
    const unfulfilled = Math.max(0, reqQty - actualQty);

    item.totalReqQty += reqQty;
    item.totalActualQty += actualQty;
    item.totalSalesAmount += supplyPrice;

    // 5로 시작하면 제품, 아니면 상품 (하림 로직)
    if (code.startsWith('5')) productSales += supplyPrice;
    else merchandiseSales += supplyPrice;

    // 미납 건 처리
    if (unfulfilled > 0) {
        item.totalUnfulfilledQty += unfulfilled;
        const unitPrice = reqQty > 0 ? (supplyPrice / reqQty) : 0;
        item.totalUnfulfilledValue += unfulfilled * unitPrice;

        let cause = '기타';
        // 박스 재고를 EA로 환산하여 비교 (정확도 향상)
        const inv = invMap.get(code);
        const conversion = inv?.UMREZ_BOX || 1;
        const currentStockEA = (inv?.CLABS || 0) * conversion; // 박스 -> 낱개 환산 필요 시

        // 단순 비교 (EA vs EA)
        if ((item.inventory.stock * conversion) >= unfulfilled) cause = '물류/출하 지연';
        else cause = '재고 부족';

        let daysDelayed = 0;
        if (order.VDATU && order.VDATU.length === 8) {
            const dateStr = `${order.VDATU.slice(0, 4)}-${order.VDATU.slice(4, 6)}-${order.VDATU.slice(6, 8)}`;
            daysDelayed = differenceInCalendarDays(today, parseISO(dateStr));
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

    // 거래처 분석
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

  // 2. 생산 데이터 병합
  productionList.forEach(prod => {
    const code = prod.MATNR;
    if (!integratedMap.has(code)) initializeItem(integratedMap, code, prod.MAKTX, invMap, velocityMap, prod.MEINS);
    const item = integratedMap.get(code)!;
    item.production.planQty += Number(prod.PSMNG || 0);
    item.production.receivedQty += Number(prod.LMNGA || 0);
  });

  // 3. 재고 Backfill (매출/생산 없는 품목)
  inventoryList.forEach(inv => {
    if (inv.CLABS > 0 && !integratedMap.has(inv.MATNR)) {
      initializeItem(integratedMap, inv.MATNR, inv.MATNR_T, invMap, velocityMap, inv.MEINS);
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
    // 생산 달성률
    if (item.production.planQty > 0) {
        item.production.achievementRate = (item.production.receivedQty / item.production.planQty) * 100;
    }
    
    totalUnfulfilledValue += item.totalUnfulfilledValue;
    if (item.unfulfilledOrders.some(o => o.daysDelayed >= 7)) criticalDeliveryCount++;

    // 재고 상태 카운트 (재고가 있는 경우만)
    if (item.inventory.stock > 0) {
        stockHealth[item.inventory.status]++;
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
      overallFulfillmentRate: '0.0', // 별도 계산 필요 시 로직 추가
      totalUnfulfilledValue,
      criticalDeliveryCount
    },
    stockHealth,
    salesAnalysis: {
      byBrand: toSortedArray(salesByBrand),
      byCategory: toSortedArray(salesByCategory),
      byFamily: toSortedArray(salesByFamily) // 로직 필요 시 추가 구현
    },
    integratedArray,
    fulfillment: {
        summary: fulfillmentSummary,
        byCustomer: customerStats
    }
  };
}

function initializeItem(
  map: Map<string, IntegratedItem>,
  code: string,
  nameHint: string,
  invMap: Map<string, SapInventory>,
  velocityMap: Map<string, number>,
  unit: string
) {
  const invInfo = invMap.get(code);
  const ads = velocityMap.get(code) || 0;
  const recStock = Math.ceil(ads * THRESHOLDS.SAFETY_BUFFER_DAYS);
  
  // 잔여일수 가져오기 (없으면 0)
  const remainingDays = invInfo?.remain_day !== undefined ? Number(invInfo.remain_day) : 0;
  
  // 상태 판정
  const status = getStockStatus(remainingDays);
  const riskScore = status === 'critical' ? 100 : (status === 'disposed' ? 50 : 0);

  // 분류 로직 (임시)
  const brand = '하림'; 
  const category = '상온'; 
  const family = '즉석밥';

  map.set(code, {
    code,
    name: nameHint || invInfo?.MATNR_T || '',
    unit: unit || invInfo?.MEINS || 'EA',
    brand, category, family,
    totalReqQty: 0, totalActualQty: 0, totalUnfulfilledQty: 0, totalUnfulfilledValue: 0, totalSalesAmount: 0,
    inventory: {
      stock: Number(invInfo?.CLABS || 0),
      status,
      remainingDays,
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