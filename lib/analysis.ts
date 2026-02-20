import { SapOrder, SapInventory, SapProduction, FbhInventory } from '@/types/sap';
import { IntegratedItem, DashboardAnalysis, InventoryBatch, CustomerStat, UnfulfilledOrder, ProductionRow } from '@/types/analysis';
import { differenceInCalendarDays, parseISO, format, subDays } from 'date-fns';

const THRESHOLDS = {
  IMMINENT_DAYS: 30, 
  CRITICAL_DAYS: 60, 
  FIXED_ADS_DAYS: 60, 
};

function inferBrandInfo(name: string) {
  if (name.includes('The미식') || name.includes('미식')) return { brand: 'The미식', category: '상온' };
  if (name.includes('하림')) return { brand: '하림', category: '냉동' };
  if (name.includes('멜트')) return { brand: '멜트', category: '건강식' };
  if (name.includes('용가리')) return { brand: '용가리', category: '냉동' };
  if (name.includes('챔')) return { brand: '챔', category: '통조림' };
  return { brand: '기타', category: '기타' };
}

function getStockStatus(days: number, isNoExpiry: boolean): 'disposed' | 'imminent' | 'critical' | 'healthy' | 'no_expiry' {
  if (isNoExpiry) return 'no_expiry';
  
  if (days <= 0) return 'disposed';     
  if (days <= 30) return 'imminent';    // 1 ~ 30
  if (days <= 60) return 'critical';    // 31 ~ 60
  return 'healthy';                     // 61 이상
}

function calculateFbhRate(prdtDateStr: string, validDateStr: string, remainDays: number): number {
  if (!prdtDateStr || !validDateStr) return 0;
  try {
    const fmt = (d: string) => d.length === 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : d;
    const pDate = parseISO(fmt(prdtDateStr));
    const vDate = parseISO(fmt(validDateStr));
    const shelfLife = differenceInCalendarDays(vDate, pDate);
    if (shelfLife <= 0) return 0;
    return (remainDays / shelfLife) * 100;
  } catch (e) {
    return 0;
  }
}

export function analyzeSnopData(
  orders: SapOrder[],
  inventoryList: SapInventory[],
  productionList: SapProduction[],
  fbhList: FbhInventory[],
  startDateStr: string,
  endDateStr: string
): DashboardAnalysis {
  
  const filterStart = startDateStr.replace(/-/g, '');
  const filterEnd = endDateStr.replace(/-/g, '');
  const today = new Date();
  const todayYmd = format(today, 'yyyyMMdd');

  // ADS 계산을 위한 기준 날짜 (YYYYMMDD 문자열)
  const date30DaysAgo = format(subDays(today, 30), 'yyyyMMdd');
  const date60DaysAgo = format(subDays(today, 60), 'yyyyMMdd');
  const date90DaysAgo = format(subDays(today, 90), 'yyyyMMdd');

  // 1. Plant 재고 데이터 집계
  const invAggMap = new Map<string, { totalStock: number, qualityStock: number, batches: InventoryBatch[], info: SapInventory }>();
  
  inventoryList.forEach(inv => {
    if (!invAggMap.has(inv.MATNR)) {
      invAggMap.set(inv.MATNR, { totalStock: 0, qualityStock: 0, batches: [], info: inv });
    }
    const target = invAggMap.get(inv.MATNR)!;
    target.totalStock += Number(inv.CLABS || 0);
    target.qualityStock += Number(inv.CINSM || 0);
    
    let rawRate = Number(inv.remain_rate || 0);
    if (Math.abs(rawRate) <= 10) rawRate = rawRate * 100; 

    if (Number(inv.CLABS) > 0) {
      target.batches.push({
        quantity: Number(inv.CLABS || 0),
        expirationDate: inv.VFDAT || '',
        remainDays: Number(inv.remain_day || 0),
        remainRate: rawRate, 
        location: inv.LGOBE || 'Plant',
        source: 'PLANT'
      });
    }
  });

  // 1.5 FBH 재고 데이터 집계
  const fbhAggMap = new Map<string, { totalStock: number, batches: InventoryBatch[], info: FbhInventory }>();

  fbhList.forEach(fbh => {
    if (!fbhAggMap.has(fbh.SKU_CD)) {
      fbhAggMap.set(fbh.SKU_CD, { totalStock: 0, batches: [], info: fbh });
    }
    const target = fbhAggMap.get(fbh.SKU_CD)!;
    const qty = Number(fbh.AVLB_QTY || 0);
    target.totalStock += qty;

    const isCode6 = fbh.SKU_CD.startsWith('6');
    const isNoDate = !fbh.VALID_DATETIME_NEW || fbh.VALID_DATETIME_NEW.trim() === '';
    const isNoExpiry = isCode6 || isNoDate;

    const rate = isNoExpiry ? 100 : calculateFbhRate(fbh.PRDT_DATE_NEW, fbh.VALID_DATETIME_NEW, fbh.REMAINING_DAY);
    const remainDays = isNoExpiry ? 9999 : Number(fbh.REMAINING_DAY || 0); 
    const expDate = isNoExpiry ? '-' : (fbh.VALID_DATETIME_NEW || '');

    if (qty > 0) {
      target.batches.push({
        quantity: qty,
        expirationDate: expDate, 
        remainDays: remainDays,
        remainRate: rate,
        location: 'FBH',
        source: 'FBH'
      });
    }
  });

  const integratedMap = new Map<string, IntegratedItem>();
  const customerMap = new Map<string, CustomerStat & { boughtMap: Map<string, any> }>();

  // KPI 집계 변수 (초기값 0)
  let productSales = 0;
  let merchandiseSales = 0;

  // 2. 주문 데이터 처리 및 ADS 계산용 임시 저장소
  const salesHistory = new Map<string, { d30: number, d60: number, d90: number }>();

  orders.forEach(order => {
    const code = order.MATNR;
    if (!code) return;

    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, order.ARKTX, invAggMap, fbhAggMap, order.MEINS || 'EA', Number(order.UMREZ_BOX || 1));
    }
    const item = integratedMap.get(code)!;

    const supplyPrice = Number(order.NETWR || 0);
    const reqQty = Number(order.KWMENG || 0);
    const actualQty = Number(order.LFIMG_LIPS || 0);
    
    // 조회 기간(필터) 내의 데이터만 KPI 및 미납 집계에 사용
    if (order.VDATU >= filterStart && order.VDATU <= filterEnd) {
      
      // 🚨 [핵심 수정] 1031 플랜트, 2141/2143/2240/2243 창고는 미납 산정에서 제외
      const isExcludedFromUnfulfilled = 
        order.WERKS === '1031' || 
        ['2141', '2143', '2240', '2243'].includes(order.LGORT || '');

      let unfulfilled = Math.max(0, reqQty - actualQty);
      if (isExcludedFromUnfulfilled) {
        unfulfilled = 0; // 강제로 미납 0 처리
      }

      item.totalReqQty += reqQty;
      item.totalActualQty += actualQty;
      item.totalSalesAmount += supplyPrice; 

      if (code.startsWith('5')) productSales += supplyPrice;
      else merchandiseSales += supplyPrice;

      if (unfulfilled > 0) {
          item.totalUnfulfilledQty += unfulfilled;
          
          let unitPrice = reqQty > 0 ? Math.abs(supplyPrice) / reqQty : 0;
          const missedVal = unfulfilled * unitPrice;
          
          item.totalUnfulfilledValue += missedVal;

          let cause = '재고 부족';
          if (item.inventory.totalStock > 0) cause = '당일 재고 부족'; 

          let daysDelayed = 0;
          if (order.VDATU && order.VDATU.length === 8) {
              try {
                  const dStr = `${order.VDATU.slice(0, 4)}-${order.VDATU.slice(4, 6)}-${order.VDATU.slice(6, 8)}`;
                  daysDelayed = differenceInCalendarDays(today, parseISO(dStr));
              } catch(e) {}
          }

          item.unfulfilledOrders.push({
              place: order.NAME1 || '알수없음',
              productName: item.name,
              qty: unfulfilled,
              value: missedVal,
              unitPrice,
              reqDate: order.VDATU,
              daysDelayed,
              cause
          });
      }
      
      // 거래처 집계 (필터 기간 내)
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
          item.unfulfilledOrders.forEach(uo => {
              if (uo.place === cust.name && uo.reqDate === order.VDATU) cust.unfulfilledDetails.push(uo);
          });
          let unitPrice = reqQty > 0 ? Math.abs(supplyPrice) / reqQty : 0;
          cust.missedRevenue += unfulfilled * unitPrice;
      }
    }

    // ADS 계산용 판매량 집계
    if (!salesHistory.has(code)) {
      salesHistory.set(code, { d30: 0, d60: 0, d90: 0 });
    }
    const sales = salesHistory.get(code)!;
    const vDate = order.VDATU;
    const qtyForAds = Number(order.LFIMG_LIPS || 0);

    if (vDate >= date30DaysAgo) sales.d30 += qtyForAds;
    if (vDate >= date60DaysAgo) sales.d60 += qtyForAds;
    if (vDate >= date90DaysAgo) sales.d90 += qtyForAds;
  });

  // 3. 생산 데이터 처리
  const processedProductionList: ProductionRow[] = [];
  productionList.forEach(prod => {
    const code = prod.MATNR;
    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, prod.MAKTX, invAggMap, fbhAggMap, prod.MEINS || 'EA', Number(prod.UMREZ_BOX || 1));
    }
    const item = integratedMap.get(code)!;
    const dateStr = prod.GSTRP; 

    if (dateStr && dateStr >= filterStart && dateStr <= filterEnd) {
      item.production.planQty += Number(prod.PSMNG || 0);
      item.production.receivedQty += Number(prod.LMNGA || 0);
    }
    if (dateStr && dateStr >= todayYmd) {
      item.production.futurePlanQty += Number(prod.PSMNG || 0);
    }

    let status: 'pending' | 'progress' | 'completed' | 'poor' = 'pending';
    const plan = Number(prod.PSMNG || 0);
    const actual = Number(prod.LMNGA || 0);
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

  // 4. 재고만 있는 아이템 추가
  invAggMap.forEach((val, key) => {
    if (!integratedMap.has(key)) {
      initializeItem(integratedMap, key, val.info.MATNR_T, invAggMap, fbhAggMap, val.info.MEINS, Number(val.info.UMREZ_BOX || 1));
    }
  });

  fbhAggMap.forEach((val, key) => {
    if (!integratedMap.has(key)) {
      initializeItem(integratedMap, key, val.info.MATNR_T, invAggMap, fbhAggMap, val.info.MEINS, Number(val.info.UMREZ_BOX || 1));
    }
  });

  const integratedArray = Array.from(integratedMap.values());
  const stockHealth = { disposed: 0, imminent: 0, critical: 0, healthy: 0, no_expiry: 0 };

  integratedArray.forEach(item => {
    const history = salesHistory.get(item.code) || { d30: 0, d60: 0, d90: 0 };
    
    item.inventory.ads30 = history.d30 / 30;
    item.inventory.ads60 = history.d60 / 60;
    item.inventory.ads90 = history.d90 / 90;
    item.inventory.ads = item.inventory.ads60; 

    if (item.inventory.totalStock > 0) {
        stockHealth[item.inventory.status]++;
    }
  });

  const totalUnfulfilledValue = integratedArray.reduce((acc, item) => acc + item.totalUnfulfilledValue, 0);
  
  const criticalDeliveryCount = integratedArray.reduce((acc, item) => {
      const lateCount = item.unfulfilledOrders.filter(o => o.daysDelayed >= 7).length;
      return acc + lateCount;
  }, 0);

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

function initializeItem(
  map: Map<string, IntegratedItem>,
  code: string,
  nameHint: string,
  invMap: Map<string, { totalStock: number, qualityStock: number, batches: InventoryBatch[], info: SapInventory }>,
  fbhMap: Map<string, { totalStock: number, batches: InventoryBatch[], info: FbhInventory }>,
  unit: string,
  umrezBox: number
) {
  const plantData = invMap.get(code);
  const fbhData = fbhMap.get(code);

  const plantStock = plantData?.totalStock || 0;
  const fbhStock = fbhData?.totalStock || 0;
  const qualityStock = plantData?.qualityStock || 0;
  const totalStock = plantStock + fbhStock;

  const plantBatches = plantData?.batches || [];
  const fbhBatches = fbhData?.batches || [];
  
  const statusBreakdown = { disposed: 0, imminent: 0, critical: 0, healthy: 0, no_expiry: 0 };
  const allBatches = [...plantBatches, ...fbhBatches];
  
  let minRemaining = 9999;
  
  const isProductNoExpiry = code.startsWith('6');

  if (allBatches.length > 0) {
    minRemaining = Math.min(...allBatches.map(b => b.remainDays));
    allBatches.forEach(b => {
      const isBatchNoExpiry = isProductNoExpiry || b.expirationDate === '-' || b.expirationDate === '';
      const s = getStockStatus(b.remainDays, isBatchNoExpiry);
      statusBreakdown[s] += b.quantity;
    });
  } else if (totalStock > 0) {
    if (isProductNoExpiry) statusBreakdown['no_expiry'] = totalStock;
    else statusBreakdown['healthy'] = totalStock;
  }

  const worstBatch = allBatches.sort((a, b) => a.remainDays - b.remainDays)[0];
  const isWorstNoExpiry = isProductNoExpiry || (worstBatch && (worstBatch.expirationDate === '-' || worstBatch.expirationDate === ''));
  
  const status = totalStock > 0 ? getStockStatus(minRemaining, isWorstNoExpiry || false) : 'healthy';

  let brand = '기타', category = '미지정', family = '기타';
  if (plantData?.info.PRDHA_1_T) {
      brand = plantData.info.PRDHA_1_T;
      category = plantData.info.PRDHA_2_T || '미지정';
      family = plantData.info.PRDHA_3_T || '기타';
  } else {
      const inferred = inferBrandInfo(nameHint);
      brand = inferred.brand;
      category = inferred.category;
  }

  const safeName = nameHint || plantData?.info.MATNR_T || fbhData?.info.MATNR_T || '';
  const safeUmrez = umrezBox > 1 ? umrezBox : (plantData?.info.UMREZ_BOX || fbhData?.info.UMREZ_BOX || 1);

  map.set(code, {
    code,
    name: safeName,
    unit: unit || 'EA',
    brand, category, family,
    umrezBox: safeUmrez,
    totalReqQty: 0, totalActualQty: 0, totalUnfulfilledQty: 0, totalUnfulfilledValue: 0, totalSalesAmount: 0,
    inventory: {
      totalStock,      
      plantStock,      
      fbhStock,        
      qualityStock,
      usableStock: totalStock,
      plantBatches,
      fbhBatches,
      batches: allBatches, 
      status,
      statusBreakdown,
      remainingDays: minRemaining === 9999 ? 0 : minRemaining,
      riskScore: 0,
      ads: 0, 
      ads30: 0, 
      ads60: 0, 
      ads90: 0, 
      recommendedStock: 0
    },
    production: { planQty: 0, futurePlanQty: 0, receivedQty: 0, achievementRate: 0, lastReceivedDate: null },
    unfulfilledOrders: []
  });
}