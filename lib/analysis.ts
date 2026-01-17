import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { IntegratedItem, DashboardAnalysis, InventoryBatch, CustomerStat, UnfulfilledOrder } from '@/types/analysis';
import { differenceInCalendarDays, parseISO } from 'date-fns';

const THRESHOLDS = {
  CRITICAL_DAYS: 30, 
  SAFETY_BUFFER_DAYS: 14, 
};

// 1. 판매 속도(ADS) 계산
function calculateSalesVelocity(orders: SapOrder[], days: number): Map<string, number> {
  const map = new Map<string, number>();
  const safeDays = Math.max(1, days); 

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

// 2. 재고 상태 판별
function getStockStatus(days: number): 'disposed' | 'critical' | 'healthy' {
  if (days <= 0) return 'disposed';
  if (days <= THRESHOLDS.CRITICAL_DAYS) return 'critical';
  return 'healthy';
}

// 3. 제품명 기반 브랜드/카테고리 추론
function inferBrandInfo(name: string) {
  if (name.includes('The미식') || name.includes('미식')) return { brand: 'The미식', category: '상온' };
  if (name.includes('하림')) return { brand: '하림', category: '냉동' };
  if (name.includes('멜트')) return { brand: '멜트', category: '건강식' };
  if (name.includes('용가리')) return { brand: '용가리', category: '냉동' };
  if (name.includes('챔')) return { brand: '챔', category: '통조림' };
  return { brand: '기타', category: '기타' };
}

export function analyzeSnopData(
  orders: SapOrder[],
  inventoryList: SapInventory[],
  productionList: SapProduction[],
  startDateStr: string,
  endDateStr: string
): DashboardAnalysis {
  
  let daysDiff = 60;
  try {
    if (startDateStr && endDateStr) {
      daysDiff = differenceInCalendarDays(parseISO(endDateStr), parseISO(startDateStr)) + 1;
    }
  } catch (e) {
    console.error("Date parsing error:", e);
  }

  const velocityMap = calculateSalesVelocity(orders, daysDiff);
  
  // 재고 집계
  const invAggMap = new Map<string, { totalStock: number, batches: InventoryBatch[], info: SapInventory }>();
  inventoryList.forEach(inv => {
    if (!invAggMap.has(inv.MATNR)) {
      invAggMap.set(inv.MATNR, { totalStock: 0, batches: [], info: inv });
    }
    const target = invAggMap.get(inv.MATNR)!;
    target.totalStock += Number(inv.CLABS || 0);
    target.batches.push({
      quantity: Number(inv.CLABS || 0),
      expirationDate: inv.VFDAT || '',
      remainDays: Number(inv.remain_day || 0),
      remainRate: Number(inv.remain_rate || 0),
      location: inv.LGOBE || ''
    });
  });

  const integratedMap = new Map<string, IntegratedItem>();
  
  type CustomerTemp = CustomerStat & { boughtMap: Map<string, {name:string, qty:number, value:number}> };
  const customerMap = new Map<string, CustomerTemp>();

  let productSales = 0;
  let merchandiseSales = 0;
  const today = new Date();

  // --- 1. 주문 데이터 처리 ---
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

    // 상세 미납 정보 생성
    let unfulfilledInfo: UnfulfilledOrder | null = null;

    if (unfulfilled > 0) {
        item.totalUnfulfilledQty += unfulfilled;
        
        let unitPrice = 0;
        if (reqQty > 0) unitPrice = Math.abs(supplyPrice) / reqQty;
        item.totalUnfulfilledValue += unfulfilled * unitPrice;

        // 🚨 [수정 완료] 미납 원인 로직 변경 (물류 지연 제거)
        let cause = '재고 부족';
        if (item.inventory.totalStock > 0) {
            // 현재 재고는 있으나, 주문 당시 없었으므로 '당일 재고 부족'
            cause = '당일 재고 부족'; 
        } else {
            // 현재도 재고가 없음
            cause = '재고 부족';
        }

        let daysDelayed = 0;
        if (order.VDATU && order.VDATU.length === 8) {
            try {
                const dateStr = `${order.VDATU.slice(0, 4)}-${order.VDATU.slice(4, 6)}-${order.VDATU.slice(6, 8)}`;
                daysDelayed = differenceInCalendarDays(today, parseISO(dateStr));
            } catch(e) {}
        }

        unfulfilledInfo = {
            place: order.NAME1 || '알수없음',
            productName: item.name,
            qty: unfulfilled,
            value: unfulfilled * unitPrice,
            unitPrice,
            reqDate: order.VDATU,
            daysDelayed,
            cause
        };

        item.unfulfilledOrders.push(unfulfilledInfo);
    }

    // --- 거래처 집계 ---
    const custId = order.KUNNR || 'UNKNOWN';
    if (!customerMap.has(custId)) {
        customerMap.set(custId, {
            id: custId, name: order.NAME1 || '알수없음',
            orderCount: 0, fulfilledCount: 0, totalRevenue: 0, missedRevenue: 0, fulfillmentRate: 0,
            topBoughtProducts: [], 
            unfulfilledDetails: [],
            boughtMap: new Map()
        });
    }
    const cust = customerMap.get(custId)!;
    cust.orderCount++;
    cust.totalRevenue += supplyPrice;

    if (!cust.boughtMap.has(code)) {
        cust.boughtMap.set(code, { name: item.name, qty: 0, value: 0 });
    }
    const prodStat = cust.boughtMap.get(code)!;
    prodStat.qty += reqQty;
    prodStat.value += supplyPrice;

    if (unfulfilled <= 0) {
        cust.fulfilledCount++;
    } else {
        if (unfulfilledInfo) cust.unfulfilledDetails.push(unfulfilledInfo);
        let unitPrice = 0;
        if (reqQty > 0) unitPrice = Math.abs(supplyPrice) / reqQty;
        cust.missedRevenue += unfulfilled * unitPrice;
    }
  });

  // --- 2. 생산 데이터 처리 ---
  productionList.forEach(prod => {
    const code = prod.MATNR;
    if (!integratedMap.has(code)) initializeItem(integratedMap, code, prod.MAKTX, invAggMap, velocityMap, prod.MEINS);
    const item = integratedMap.get(code)!;
    item.production.planQty += Number(prod.PSMNG || 0);
    item.production.receivedQty += Number(prod.LMNGA || 0);
  });

  // --- 3. 재고 데이터 Backfill ---
  invAggMap.forEach((val, key) => {
    if (!integratedMap.has(key)) {
      initializeItem(integratedMap, key, val.info.MATNR_T, invAggMap, velocityMap, val.info.MEINS);
    }
  });

  // --- 4. 최종 KPI 계산 ---
  const integratedArray = Array.from(integratedMap.values());
  let totalUnfulfilledValue = 0;
  let criticalDeliveryCount = 0;
  const stockHealth = { disposed: 0, critical: 0, healthy: 0 };

  integratedArray.forEach(item => {
    if (item.production.planQty > 0) {
        item.production.achievementRate = (item.production.receivedQty / item.production.planQty) * 100;
    }
    totalUnfulfilledValue += item.totalUnfulfilledValue;
    if (item.unfulfilledOrders.some(o => o.daysDelayed >= 7)) criticalDeliveryCount++;

    if (item.inventory.totalStock === 0) {
        if (item.totalUnfulfilledQty > 0) item.inventory.status = 'critical'; 
    }

    if (item.inventory.totalStock > 0) {
        if (item.inventory.status === 'disposed') stockHealth.disposed++;
        else if (item.inventory.status === 'critical') stockHealth.critical++;
        else stockHealth.healthy++;
    }

    item.inventory.ads = daysDiff > 0 ? (item.totalSalesAmount / daysDiff) : 0;
  });

  const customerStats = Array.from(customerMap.values()).map(c => {
      c.fulfillmentRate = c.orderCount > 0 ? (c.fulfilledCount / c.orderCount) * 100 : 0;
      
      c.topBoughtProducts = Array.from(c.boughtMap.values())
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
      
      return c;
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const fulfillmentSummary = {
      totalOrders: orders.length,
      fulfilledOrders: customerStats.reduce((acc, c) => acc + c.fulfilledCount, 0),
      unfulfilledCount: orders.length - customerStats.reduce((acc, c) => acc + c.fulfilledCount, 0),
      totalCustomers: customerStats.length,
      averageRate: 0
  };

  const topProducts = integratedArray
    .sort((a, b) => b.totalSalesAmount - a.totalSalesAmount)
    .slice(0, 5)
    .map(item => ({ name: item.name, value: item.totalSalesAmount }));

  const topCustomers = customerStats
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 5)
    .map(c => ({ name: c.name, value: c.totalRevenue }));

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
      topProducts,
      topCustomers
    },
    integratedArray,
    fulfillment: { summary: fulfillmentSummary, byCustomer: customerStats }
  };
}

// 초기화 함수
function initializeItem(
  map: Map<string, IntegratedItem>,
  code: string,
  nameHint: string,
  invMap: Map<string, { totalStock: number, batches: InventoryBatch[], info: SapInventory }>,
  velocityMap: Map<string, number>,
  unit: string
) {
  const invData = invMap.get(code);
  const adsQty = velocityMap.get(code) || 0;
  const recStock = Math.ceil(adsQty * THRESHOLDS.SAFETY_BUFFER_DAYS);
  
  let minRemaining = 9999;
  if (invData && invData.batches.length > 0) {
    minRemaining = Math.min(...invData.batches.map(b => b.remainDays));
  } else if (invData && invData.info.remain_day !== undefined) {
    minRemaining = Number(invData.info.remain_day);
  }

  const status = invData ? getStockStatus(minRemaining) : 'healthy';
  const riskScore = status === 'critical' ? 100 : (status === 'disposed' ? 50 : 0);

  let brand = '기타';
  let category = '미지정';

  if (invData?.info.PRDHA_1_T) {
      brand = invData.info.PRDHA_1_T;
      category = invData.info.PRDHA_2_T || '미지정';
  } else {
      const inferred = inferBrandInfo(nameHint);
      brand = inferred.brand;
      category = inferred.category;
  }
  
  const family = invData?.info.PRDHA_3_T || '기타';

  map.set(code, {
    code,
    name: nameHint || invData?.info.MATNR_T || '',
    unit: unit || invData?.info.MEINS || 'EA',
    brand, category, family,
    totalReqQty: 0, totalActualQty: 0, totalUnfulfilledQty: 0, totalUnfulfilledValue: 0, totalSalesAmount: 0,
    inventory: {
      totalStock: invData?.totalStock || 0,
      usableStock: invData?.totalStock || 0,
      batches: invData?.batches || [],
      status,
      remainingDays: minRemaining === 9999 ? 0 : minRemaining,
      riskScore,
      ads: 0,
      recommendedStock: recStock
    },
    production: {
      planQty: 0, receivedQty: 0, achievementRate: 0, lastReceivedDate: null
    },
    unfulfilledOrders: []
  });
}