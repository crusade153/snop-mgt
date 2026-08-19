import type { SapOrder, SapInventory, SapProduction, SapProductConsumption, FbhInventory } from '@/types/sap';
import type { IntegratedItem, DashboardAnalysis, InventoryBatch, CustomerStat, UnfulfilledOrder, ProductionRow } from '@/types/analysis';
import { differenceInCalendarDays, parseISO, format, subDays } from 'date-fns';
import { classifyInventoryStock, getProductionLine } from '@/lib/inventory-classification';
import type { PriceSource } from '@/lib/ending-inventory-price';

type PlantInventoryAggregate = {
  totalStock: number;
  qualityStock: number;
  stockValue: number;
  qualityStockValue: number;
  batches: InventoryBatch[];
  info: SapInventory;
};

type FbhInventoryAggregate = {
  totalStock: number;
  batches: InventoryBatch[];
  info: FbhInventory;
};

const THRESHOLDS = {
  IMMINENT_DAYS: 30, 
  CRITICAL_DAYS: 60, 
  FIXED_ADS_DAYS: 60, 
};

// 🚨 [완벽 조치 1] SAP 더미 날짜(1899-12-30, 00000000 등)를 기한없음으로 정확히 걸러내는 방탄 함수
/**
 * SAP 날짜값 → 'YYYYMMDD'. 더미 날짜(00000000·1899·1900·1970·2000년 미만)는 빈 문자열로 떨군다.
 *
 * 주간 장표(lib/weekly/*)도 같은 판정을 써야 해서 export 한다.
 * 이 규칙을 복사해 두 벌로 만들면 '기한없음' 판정이 화면마다 갈린다.
 */
export function safeExtractDateStr(val: any): string {
  if (!val) return '';

  try {
    let y = 0, m = '', d = '';

    // 1. 이미 자바스크립트 Date 객체인 경우
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return '';
      y = val.getFullYear();
      m = String(val.getMonth() + 1).padStart(2, '0');
      d = String(val.getDate()).padStart(2, '0');
    } else {
      let str = '';
      if (typeof val === 'object' && val !== null && 'value' in val) {
        str = String(val.value);
      } else {
        str = String(val);
      }

      str = str.trim();
      // SAP 특유의 빈 날짜값 처리
      if (!str || str === '00000000' || str === '-' || str.includes('1899') || str.includes('1900') || str.includes('1970')) {
        return '';
      }

      // 정규식으로 YYYYMMDD 추출
      const match = str.match(/(20\d{2})[-./]?(\d{2})[-./]?(\d{2})/);
      if (match) {
        y = parseInt(match[1], 10);
        m = match[2];
        d = match[3];
      } else {
        // 최후의 문자열 Date 파싱
        const parsedDate = new Date(str);
        if (!isNaN(parsedDate.getTime())) {
          y = parsedDate.getFullYear();
          m = String(parsedDate.getMonth() + 1).padStart(2, '0');
          d = String(parsedDate.getDate()).padStart(2, '0');
        } else {
          return '';
        }
      }
    }

    // 🚨 핵심 방어 로직: 2000년 미만(1899년 등)은 무조건 기한없음(빈 문자열) 처리
    if (y < 2000) return ''; 

    return `${y}${m}${d}`;
  } catch (e) {
    return '';
  }
}

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
  try {
    const pStr = safeExtractDateStr(prdtDateStr);
    const vStr = safeExtractDateStr(validDateStr);
    if (pStr.length !== 8 || vStr.length !== 8) return 0;

    const pDate = parseISO(`${pStr.slice(0,4)}-${pStr.slice(4,6)}-${pStr.slice(6,8)}`);
    const vDate = parseISO(`${vStr.slice(0,4)}-${vStr.slice(4,6)}-${vStr.slice(6,8)}`);
    
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
  endDateStr: string,
  priceAsOfLabel: string = '',
  /** MM_MB51 261-262 생산투입 순소요. 제품 코드로 등록됐지만 다시 자재로 투입되는 품목의 실소요다 */
  productConsumptions: SapProductConsumption[] = []
): DashboardAnalysis {
  
  const filterStart = startDateStr.replace(/-/g, '');
  const filterEnd = endDateStr.replace(/-/g, '');
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 시간 오차 방지
  const todayYmd = format(today, 'yyyyMMdd');

  const date30DaysAgo = format(subDays(today, 30), 'yyyyMMdd');
  const date60DaysAgo = format(subDays(today, 60), 'yyyyMMdd');
  const date90DaysAgo = format(subDays(today, 90), 'yyyyMMdd');

  const invAggMap = new Map<string, PlantInventoryAggregate>();
  
  inventoryList.forEach(inv => {
    if (!invAggMap.has(inv.MATNR)) {
      invAggMap.set(inv.MATNR, {
        totalStock: 0,
        qualityStock: 0,
        stockValue: 0,
        qualityStockValue: 0,
        batches: [],
        info: inv,
      });
    }
    const target = invAggMap.get(inv.MATNR)!;
    target.totalStock += Number(inv.CLABS || 0);
    target.qualityStock += Number(inv.CINSM || 0);
    target.stockValue += Number(inv.STOCK_VALUE || 0);
    target.qualityStockValue += Number(inv.QUALITY_STOCK_VALUE || 0);
    
    let rawRate = Number(inv.remain_rate || 0);
    if (Math.abs(rawRate) <= 10) rawRate = rawRate * 100; 

    if (Number(inv.CLABS) > 0 || Number(inv.CINSM) > 0) {
      let expDate = safeExtractDateStr(inv.VFDAT);
      let calcRemainDays = 9999;
      
      if (expDate && expDate.length === 8) {
          try {
              const dStr = `${expDate.slice(0,4)}-${expDate.slice(4,6)}-${expDate.slice(6,8)}`;
              const parsedDate = parseISO(dStr);
              if (!isNaN(parsedDate.getTime())) {
                  calcRemainDays = differenceInCalendarDays(parsedDate, today);
              } else {
                  expDate = '기한없음';
              }
          } catch(e) {
              expDate = '기한없음';
          }
      } else {
          expDate = '기한없음';
      }

      target.batches.push({
        quantity: Number(inv.CLABS || 0),
        qualityQuantity: Number(inv.CINSM || 0),
        expirationDate: expDate,
        remainDays: calcRemainDays,
        remainRate: rawRate, 
        location: inv.LGOBE || 'Plant',
        source: 'PLANT',
        werks: inv.WERKS,
        dispo: inv.DISPO,
        stockType: classifyInventoryStock(inv.MATNR, inv.DISPO),
        productionLine: getProductionLine(inv.DISPO),
        valuationUnitPrice: Number(inv.VALUATION_UNIT_PRICE || 0),
        stockValue: Number(inv.STOCK_VALUE || 0),
        priceSource: inv.PRICE_SOURCE || 'UNKNOWN',
      });
    }
  });

  const fbhAggMap = new Map<string, FbhInventoryAggregate>();

  fbhList.forEach(fbh => {
    if (!fbhAggMap.has(fbh.SKU_CD)) {
      fbhAggMap.set(fbh.SKU_CD, { totalStock: 0, batches: [], info: fbh });
    }
    const target = fbhAggMap.get(fbh.SKU_CD)!;
    const qty = Number(fbh.AVLB_QTY || 0);
    target.totalStock += qty;

    let expDate = safeExtractDateStr(fbh.VALID_DATETIME_NEW);
    let calcRemainDays = 9999;

    if (expDate && expDate.length === 8) {
        try {
            const dStr = `${expDate.slice(0,4)}-${expDate.slice(4,6)}-${expDate.slice(6,8)}`;
            const parsedDate = parseISO(dStr);
            if (!isNaN(parsedDate.getTime())) {
                calcRemainDays = differenceInCalendarDays(parsedDate, today);
            } else {
                expDate = '기한없음';
            }
        } catch(e) {
            expDate = '기한없음';
        }
    } else {
        expDate = '기한없음';
    }

    const rate = expDate === '기한없음' ? 100 : calculateFbhRate(fbh.PRDT_DATE_NEW, fbh.VALID_DATETIME_NEW, calcRemainDays);

    if (qty > 0) {
      target.batches.push({
        quantity: qty,
        qualityQuantity: 0,
        expirationDate: expDate, 
        remainDays: calcRemainDays,
        remainRate: rate,
        location: 'FBH',
        source: 'FBH',
        stockType: classifyInventoryStock(fbh.SKU_CD),
        productionLine: null,
        valuationUnitPrice: Number(fbh.VALUATION_UNIT_PRICE || 0),
        stockValue: qty * Number(fbh.VALUATION_UNIT_PRICE || 0),
        priceSource: fbh.PRICE_SOURCE || 'UNKNOWN',
      });
    }
  });

  const integratedMap = new Map<string, IntegratedItem>();
  const customerMap = new Map<string, CustomerStat & { boughtMap: Map<string, any> }>();

  let productSales = 0;
  let merchandiseSales = 0;
  const salesHistory = new Map<string, { d30: number, d60: number, d90: number }>();
  /** 생산투입(261-262) 순소요. 판매출고와 같은 30/60/90일 창으로 접는다 */
  const usageHistory = new Map<string, { d30: number, d60: number, d90: number }>();

  productConsumptions.forEach(row => {
    const code = row.MATNR;
    if (!code) return;
    const budat = safeExtractDateStr(row.BUDAT);
    if (!budat) return;
    const qty = Number(row.NET_QTY || 0);
    if (!qty) return;

    if (!usageHistory.has(code)) usageHistory.set(code, { d30: 0, d60: 0, d90: 0 });
    const usage = usageHistory.get(code)!;
    if (budat >= date30DaysAgo) usage.d30 += qty;
    if (budat >= date60DaysAgo) usage.d60 += qty;
    if (budat >= date90DaysAgo) usage.d90 += qty;
  });

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
    
    if (order.VDATU >= filterStart && order.VDATU <= filterEnd) {
      const orderVdatuStr = safeExtractDateStr(order.VDATU);
      const isExcludedFromUnfulfilled = 
        order.WERKS === '1031' || 
        ['1110','2141', '2143', '2240', '2243'].includes(order.LGORT || '') ||
        orderVdatuStr >= todayYmd;

      let unfulfilled = Math.max(0, reqQty - actualQty);
      if (isExcludedFromUnfulfilled) {
        unfulfilled = 0; 
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
          const orderDateStr = orderVdatuStr; 
          if (orderDateStr && orderDateStr.length === 8) {
              try {
                  const dStr = `${orderDateStr.slice(0, 4)}-${orderDateStr.slice(4, 6)}-${orderDateStr.slice(6, 8)}`;
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

    if (!salesHistory.has(code)) {
      salesHistory.set(code, { d30: 0, d60: 0, d90: 0 });
    }
    const sales = salesHistory.get(code)!;
    const vDate = safeExtractDateStr(order.VDATU);
    const qtyForAds = Number(order.LFIMG_LIPS || 0);

    if (vDate >= date30DaysAgo) sales.d30 += qtyForAds;
    if (vDate >= date60DaysAgo) sales.d60 += qtyForAds;
    if (vDate >= date90DaysAgo) sales.d90 += qtyForAds;
  });

  const processedProductionList: ProductionRow[] = [];
  productionList.forEach(prod => {
    const code = prod.MATNR;
    if (!integratedMap.has(code)) {
        initializeItem(integratedMap, code, prod.MAKTX, invAggMap, fbhAggMap, prod.MEINS || 'EA', Number(prod.UMREZ_BOX || 1));
    }
    const item = integratedMap.get(code)!;
    const dateStr = safeExtractDateStr(prod.GSTRP); 

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
    const usage = usageHistory.get(item.code) || { d30: 0, d60: 0, d90: 0 };

    // ADS = 납품출고 + 생산투입 순소요. 취소(262)가 투입(261)을 넘겨 음수가 되면 0 으로 막는다
    // (실측 748품목 전부 양수였지만, 월말 대량 취소 전기 때 음수가 나면 ADS 를 깎아버린다).
    item.inventory.salesAds30 = history.d30 / 30;
    item.inventory.salesAds60 = history.d60 / 60;
    item.inventory.salesAds90 = history.d90 / 90;
    item.inventory.usageAds30 = Math.max(0, usage.d30) / 30;
    item.inventory.usageAds60 = Math.max(0, usage.d60) / 60;
    item.inventory.usageAds90 = Math.max(0, usage.d90) / 90;
    item.inventory.ads30 = item.inventory.salesAds30 + item.inventory.usageAds30;
    item.inventory.ads60 = item.inventory.salesAds60 + item.inventory.usageAds60;
    item.inventory.ads90 = item.inventory.salesAds90 + item.inventory.usageAds90;
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
    productionList: processedProductionList,
    priceAsOfLabel
  };
}

// 🚨 [완벽 조치 2] 단 1개의 폐기 배치로 전체 라벨이 오염되는 현상을 방지하는 '수량 기반 대표 상태(Majority Status)' 산출 로직
function initializeItem(
  map: Map<string, IntegratedItem>,
  code: string,
  nameHint: string,
  invMap: Map<string, PlantInventoryAggregate>,
  fbhMap: Map<string, FbhInventoryAggregate>,
  unit: string,
  umrezBox: number
) {
  const plantData = invMap.get(code);
  const fbhData = fbhMap.get(code);

  const plantStock = plantData?.totalStock || 0;
  const fbhStock = fbhData?.totalStock || 0;
  const qualityStock = plantData?.qualityStock || 0;
  const totalStock = plantStock + fbhStock;
  const plantStockValue = plantData?.stockValue || 0;
  const qualityStockValue = plantData?.qualityStockValue || 0;
  const valuationUnitPrice =
    Number(plantData?.info.VALUATION_UNIT_PRICE || 0) ||
    Number(fbhData?.info.VALUATION_UNIT_PRICE || 0);

  const plantBatches = plantData?.batches || [];
  const plantStockTypes = Array.from(new Set(plantBatches.map((batch) => batch.stockType)));
  const plantDispoCodes = Array.from(
    new Set(plantBatches.map((batch) => batch.dispo).filter((value): value is string => Boolean(value)))
  ).sort();
  const plantProductionLines = Array.from(
    new Set(
      plantBatches
        .map((batch) => batch.productionLine)
        .filter((value): value is string => Boolean(value))
    )
  );
  const fallbackStockType = plantStockTypes[0] || classifyInventoryStock(code);
  const fallbackDispo = plantDispoCodes[0];
  const fallbackProductionLine = getProductionLine(fallbackDispo);
  const fbhBatches = (fbhData?.batches || []).map((batch) => ({
    ...batch,
    dispo: fallbackDispo,
    stockType: code.startsWith('6') ? classifyInventoryStock(code) : fallbackStockType,
    productionLine: fallbackProductionLine,
  }));
  const fbhStockValue = fbhBatches.reduce((sum, batch) => sum + batch.stockValue, 0);
  const stockValue = plantStockValue + fbhStockValue;
  const stockTypes = Array.from(
    new Set([...plantStockTypes, ...fbhBatches.map((batch) => batch.stockType)])
  );
  const dispoCodes = Array.from(
    new Set(
      [...plantDispoCodes, ...fbhBatches.map((batch) => batch.dispo)].filter(
        (value): value is string => Boolean(value)
      )
    )
  ).sort();
  const productionLines = Array.from(
    new Set(
      [...plantProductionLines, ...fbhBatches.map((batch) => batch.productionLine)].filter(
        (value): value is string => Boolean(value)
      )
    )
  );

  // 기말재고 단가가 하나라도 붙었으면 금액을 신뢰하고, 전혀 없으면 당월생산으로 본다.
  const batchPriceSources = [...plantBatches, ...fbhBatches].map((batch) => batch.priceSource);
  const priceSource: PriceSource = batchPriceSources.includes('ENDING_INVENTORY')
    ? 'ENDING_INVENTORY'
    : batchPriceSources.includes('CURRENT_MONTH')
      ? 'CURRENT_MONTH'
      : 'UNKNOWN';

  const statusBreakdown = { disposed: 0, imminent: 0, critical: 0, healthy: 0, no_expiry: 0 };
  const allBatches = [...plantBatches, ...fbhBatches];
  
  let minRemaining = 9999;
  let finalStatus: 'healthy' | 'imminent' | 'critical' | 'disposed' | 'no_expiry' = 'healthy';

  if (allBatches.length > 0) {
    // 1. 모든 배치를 순회하며 상태별 실제 '수량'을 누적합니다.
    allBatches.forEach(b => {
      const isNoExp = !b.expirationDate || b.expirationDate === '기한없음';
      const s = getStockStatus(b.remainDays, isNoExp);
      statusBreakdown[s] += b.quantity;
    });

    // 2. 가장 많은 수량을 차지하는 상태를 대표 상태로 선정합니다 (Majority Rule)
    let maxQty = -1;
    (Object.keys(statusBreakdown) as Array<keyof typeof statusBreakdown>).forEach(key => {
      if (statusBreakdown[key] > maxQty && statusBreakdown[key] > 0) {
        maxQty = statusBreakdown[key];
        finalStatus = key;
      }
    });

    // 3. 최소 잔여일수 계산 (정보 제공용)
    const expiryBatches = allBatches.filter(b => b.expirationDate && b.expirationDate.length === 8 && b.expirationDate !== '기한없음');
    if (expiryBatches.length > 0) {
        minRemaining = Math.min(...expiryBatches.map(b => b.remainDays));
    }

  } else if (totalStock > 0) {
    finalStatus = 'no_expiry';
    statusBreakdown['no_expiry'] = totalStock;
  }

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
      stockValue,
      plantStockValue,
      fbhStockValue,
      qualityStockValue,
      valuationUnitPrice,
      priceSource,
      stockTypes,
      dispoCodes,
      productionLines,
      usableStock: totalStock,
      plantBatches,
      fbhBatches,
      batches: allBatches, 
      status: finalStatus, 
      statusBreakdown,     
      remainingDays: minRemaining === 9999 ? 0 : minRemaining,
      riskScore: 0,
      ads: 0,
      ads30: 0,
      ads60: 0,
      ads90: 0,
      salesAds30: 0,
      salesAds60: 0,
      salesAds90: 0,
      usageAds30: 0,
      usageAds60: 0,
      usageAds90: 0,
      recommendedStock: 0
    },
    production: { planQty: 0, futurePlanQty: 0, receivedQty: 0, achievementRate: 0, lastReceivedDate: null },
    unfulfilledOrders: []
  });
}
