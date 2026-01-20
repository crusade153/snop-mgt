// lib/analysis.ts
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { IntegratedItem, DashboardAnalysis, InventoryBatch, CustomerStat, UnfulfilledOrder, ProductionRow } from '@/types/analysis';
import { differenceInCalendarDays, parseISO, format } from 'date-fns';

// 상수 설정
const THRESHOLDS = {
  IMMINENT_DAYS: 30, 
  CRITICAL_DAYS: 60, 
  SAFETY_BUFFER_DAYS: 14, 
  FIXED_ADS_DAYS: 60, // ADS 계산 기준일수 (60일 고정)
};

// 브랜드/카테고리 추론 헬퍼
function inferBrandInfo(name: string) {
  if (name.includes('The미식') || name.includes('미식')) return { brand: 'The미식', category: '상온' };
  if (name.includes('하림')) return { brand: '하림', category: '냉동' };
  if (name.includes('멜트')) return { brand: '멜트', category: '건강식' };
  if (name.includes('용가리')) return { brand: '용가리', category: '냉동' };
  if (name.includes('챔')) return { brand: '챔', category: '통조림' };
  return { brand: '기타', category: '기타' };
}

// 재고 상태 판정 헬퍼 (날짜 기준)
function getStockStatus(days: number): 'disposed' | 'imminent' | 'critical' | 'healthy' {
  if (days <= 0) return 'disposed';                    
  if (days <= THRESHOLDS.IMMINENT_DAYS) return 'imminent'; 
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
  
  // 조회 기간 필터용 문자열 (YYYYMMDD)
  const filterStart = startDateStr.replace(/-/g, '');
  const filterEnd = endDateStr.replace(/-/g, '');
  const today = new Date();
  const todayYmd = format(today, 'yyyyMMdd');

  // 1. 재고 데이터 집계 (배치별 합산)
  const invAggMap = new Map<string, { totalStock: number, batches: InventoryBatch[], info: SapInventory }>();
  
  inventoryList.forEach(inv => {
    if (!invAggMap.has(inv.MATNR)) {
      invAggMap.set(inv.MATNR, { totalStock: 0, batches: [], info: inv });
    }
    const target = invAggMap.get(inv.MATNR)!;
    target.totalStock += Number(inv.CLABS || 0);
    
    // 🛠️ [수정 1] 잔여율(remain_rate) 단위 변환 로직 강화
    // DB값이 0.2, 0.002 등 비율(Ratio)로 들어오면 100을 곱해 퍼센트로 만듦
    // 값이 20, 50 처럼 이미 퍼센트면 그대로 둠 (기준값을 10으로 잡음)
    let rawRate = Number(inv.remain_rate || 0);
    if (Math.abs(rawRate) <= 10) { 
        rawRate = rawRate * 100; 
    }

    target.batches.push({
      quantity: Number(inv.CLABS || 0),
      expirationDate: inv.VFDAT || '',
      remainDays: Number(inv.remain_day || 0),
      remainRate: rawRate, // 변환된 값 저장
      location: inv.LGOBE || ''
    });
  });

  const integratedMap = new Map<string, IntegratedItem>();
  
  // 거래처 통계용 Map
  type CustomerTemp = CustomerStat & { 
    boughtMap: Map<string, {name:string, qty:number, value:number, unit:string, umrezBox:number}> 
  };
  const customerMap = new Map<string, CustomerTemp>();

  let productSales = 0;
  let merchandiseSales = 0;

  // 2. 주문(Sales) 데이터 처리
  orders.forEach(order => {
    const code = order.MATNR;
    if (!code) return;

    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, order.ARKTX, invAggMap, order.MEINS || 'EA', Number(order.UMREZ_BOX || 1));
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

    // 미납 내역 처리
    let unfulfilledInfo: UnfulfilledOrder | null = null;
    if (unfulfilled > 0) {
        item.totalUnfulfilledQty += unfulfilled;
        
        let unitPrice = 0;
        if (reqQty > 0) unitPrice = Math.abs(supplyPrice) / reqQty;
        item.totalUnfulfilledValue += unfulfilled * unitPrice;

        let cause = '재고 부족';
        if (item.inventory.totalStock > 0) {
            cause = '당일 재고 부족'; 
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

    // 거래처 집계 로직
    const custId = order.KUNNR || 'UNKNOWN';
    if (!customerMap.has(custId)) {
        customerMap.set(custId, {
            id: custId, name: order.NAME1 || '알수없음',
            orderCount: 0, fulfilledCount: 0, totalRevenue: 0, missedRevenue: 0, fulfillmentRate: 0,
            topBoughtProducts: [], unfulfilledDetails: [], boughtMap: new Map()
        });
    }
    const cust = customerMap.get(custId)!;
    cust.orderCount++;
    cust.totalRevenue += supplyPrice;

    if (!cust.boughtMap.has(code)) {
        cust.boughtMap.set(code, { 
          name: item.name, qty: 0, value: 0, unit: item.unit, umrezBox: item.umrezBox
        });
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

  // 3. 생산(Production) 데이터 처리
  const processedProductionList: ProductionRow[] = [];
  productionList.forEach(prod => {
    const code = prod.MATNR;
    const plan = Number(prod.PSMNG || 0);
    const actual = Number(prod.LMNGA || 0);
    
    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, prod.MAKTX, invAggMap, prod.MEINS || 'EA', Number(prod.UMREZ_BOX || 1));
    }
    const item = integratedMap.get(code)!;
    const dateStr = prod.GSTRP; 

    if (dateStr && dateStr >= filterStart && dateStr <= filterEnd) {
      item.production.planQty += plan;
      item.production.receivedQty += actual;
    }
    if (dateStr && dateStr >= todayYmd) {
      item.production.futurePlanQty += plan;
    }

    let status: 'pending' | 'progress' | 'completed' | 'poor' = 'pending';
    const rate = plan > 0 ? (actual / plan) * 100 : 0;
    if (actual >= plan) status = 'completed';
    else if (actual > 0 && actual < plan) status = 'progress';
    else if (rate < 90 && plan > 0) status = 'poor';

    processedProductionList.push({
      date: dateStr ? `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}` : '',
      plant: prod.WERKS || '-',
      code: prod.MATNR,
      name: prod.MAKTX,
      unit: prod.MEINS || 'EA',
      umrezBox: Number(prod.UMREZ_BOX || item.umrezBox || 1), 
      planQty: plan, actualQty: actual, rate, status
    });
  });

  // 재고만 있는 품목 추가
  invAggMap.forEach((val, key) => {
    if (!integratedMap.has(key)) {
      initializeItem(integratedMap, key, val.info.MATNR_T, invAggMap, val.info.MEINS, Number(val.info.UMREZ_BOX || 1));
    }
  });

  // 4. 최종 통합 배열 생성 및 KPI 계산
  const integratedArray = Array.from(integratedMap.values());
  let totalUnfulfilledValue = 0;
  let criticalDeliveryCount = 0;
  const stockHealth = { disposed: 0, imminent: 0, critical: 0, healthy: 0 };

  integratedArray.forEach(item => {
    if (item.production.planQty > 0) {
        item.production.achievementRate = (item.production.receivedQty / item.production.planQty) * 100;
    }
    totalUnfulfilledValue += item.totalUnfulfilledValue;
    if (item.unfulfilledOrders.some(o => o.daysDelayed >= 7)) criticalDeliveryCount++;

    item.inventory.ads = item.totalActualQty / THRESHOLDS.FIXED_ADS_DAYS;

    // 🛠️ [수정 2] 상태 판정 로직 버그 수정
    // 1. 기본적으로 날짜 기반 상태(item.inventory.status)는 initializeItem에서 이미 설정됨 (getStocksStatus 함수 사용)
    // 2. 미납이 발생하면 'Critical'로 격상하지만, 이미 'Disposed(폐기)' 상태라면 덮어쓰지 않음
    if (item.totalUnfulfilledQty > 0) {
        // 현재 상태가 '폐기(disposed)'가 아닐 때만 'Critical'로 변경
        if (item.inventory.status !== 'disposed') {
            item.inventory.status = 'critical';
        }
    }

    // 재고 건전성 카운팅
    if (item.inventory.totalStock > 0) {
        if (item.inventory.status === 'disposed') stockHealth.disposed++;
        else if (item.inventory.status === 'imminent') stockHealth.imminent++; 
        else if (item.inventory.status === 'critical') stockHealth.critical++;
        else stockHealth.healthy++;
    }
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
      topProducts: integratedArray.sort((a, b) => b.totalSalesAmount - a.totalSalesAmount).slice(0, 5).map(i => ({ name: i.name, value: i.totalSalesAmount })),
      topCustomers: customerStats.slice(0, 5).map(c => ({ name: c.name, value: c.totalRevenue }))
    },
    integratedArray,
    fulfillment: { summary: fulfillmentSummary, byCustomer: customerStats },
    productionList: processedProductionList 
  };
}

// 아이템 초기화 헬퍼
function initializeItem(
  map: Map<string, IntegratedItem>,
  code: string,
  nameHint: string,
  invMap: Map<string, { totalStock: number, batches: InventoryBatch[], info: SapInventory }>,
  unit: string,
  umrezBox: number
) {
  const invData = invMap.get(code);
  
  let minRemaining = 9999;
  if (invData && invData.batches.length > 0) {
    // 잔여일수가 가장 적은 배치를 기준으로 상태 판정
    minRemaining = Math.min(...invData.batches.map(b => b.remainDays));
  } else if (invData && invData.info.remain_day !== undefined) {
    minRemaining = Number(invData.info.remain_day);
  }

  // 1차 상태 판정 (날짜 기준)
  const status = invData ? getStockStatus(minRemaining) : 'healthy';
  
  let riskScore = 0;
  if (status === 'disposed') riskScore = 50;
  else if (status === 'imminent') riskScore = 100; 
  else if (status === 'critical') riskScore = 80;  

  let brand = '기타', category = '미지정';
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
    umrezBox: umrezBox > 0 ? umrezBox : 1, 
    totalReqQty: 0, totalActualQty: 0, totalUnfulfilledQty: 0, totalUnfulfilledValue: 0, totalSalesAmount: 0,
    inventory: {
      totalStock: invData?.totalStock || 0,
      usableStock: invData?.totalStock || 0,
      batches: invData?.batches || [],
      status, // 초기 상태 (날짜 기준)
      remainingDays: minRemaining === 9999 ? 0 : minRemaining,
      riskScore,
      ads: 0,
      recommendedStock: 0
    },
    production: { planQty: 0, receivedQty: 0, achievementRate: 0, lastReceivedDate: null, futurePlanQty: 0 },
    unfulfilledOrders: []
  });
}