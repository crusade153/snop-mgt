// types/analysis.ts
// 타입만 가져온다. 값 import 로 두면 타입 스트리핑 후에도 import 문이 남아
// Next 런타임 밖(검증 스크립트)에서 이 모듈을 못 불러온다.
import type { InventoryStockType } from '@/lib/inventory-classification';
import type { PriceSource } from '@/lib/ending-inventory-price';

export interface InventoryBatch {
  quantity: number;       
  qualityQuantity: number;
  expirationDate: string; 
  remainDays: number;     
  remainRate: number;     
  location: string;
  source: 'PLANT' | 'FBH';
  werks?: string;
  dispo?: string;
  stockType: InventoryStockType;
  productionLine: string | null;
  valuationUnitPrice: number;
  stockValue: number;
  priceSource: PriceSource;
}

export interface UnfulfilledOrder {
  place: string;       
  productName: string; 
  qty: number;         
  value: number;       
  unitPrice: number;   
  reqDate: string;     
  daysDelayed: number; 
  cause: string;       
}

export interface ProductionRow {
  date: string;       
  plant: string;      
  code: string;       
  name: string;       
  unit: string;
  umrezBox: number; 
  planQty: number;    
  actualQty: number;  
  rate: number;       
  status: 'pending' | 'progress' | 'completed' | 'poor'; 
}

export interface IntegratedItem {
  code: string;       
  name: string;       
  unit: string;       
  brand: string;      
  category: string;   
  family: string;     
  
  umrezBox: number; 

  totalReqQty: number;           
  totalActualQty: number;        
  totalUnfulfilledQty: number;   
  totalUnfulfilledValue: number; 
  totalSalesAmount: number;      

  inventory: {
    totalStock: number;       
    qualityStock: number;
    usableStock: number;

    plantStock: number; 
    fbhStock: number;   
    stockValue: number;
    plantStockValue: number;
    fbhStockValue: number;
    qualityStockValue: number;
    valuationUnitPrice: number;
    priceSource: PriceSource;
    stockTypes: InventoryStockType[];
    dispoCodes: string[];
    productionLines: string[];

    batches: InventoryBatch[]; 
    
    plantBatches: InventoryBatch[];
    fbhBatches: InventoryBatch[];
    
    status: 'healthy' | 'critical' | 'imminent' | 'disposed' | 'no_expiry'; 
    remainingDays: number;    
    riskScore: number;        
    
    // ADS 는 '납품출고 + 생산투입 순소요(MB51 261-262)' 의 일평균이다.
    // 스프·양념장처럼 제품 코드로 등록됐지만 다시 자재로 투입되는 품목이
    // 판매출고만 보면 소진속도 0 으로 잡혀서 회전일이 비었기 때문이다.
    ads: number; // 기존 호환용 (기본 60일)
    ads30: number; // 최근 30일 기준 일평균 순소요
    ads60: number; // 최근 60일 기준 일평균 순소요
    ads90: number; // 최근 90일 기준 일평균 순소요

    salesAds30: number; // 납품출고분만
    salesAds60: number;
    salesAds90: number;
    usageAds30: number; // 생산투입(261-262) 순소요분만
    usageAds60: number;
    usageAds90: number;

    recommendedStock: number; 
    
    statusBreakdown: {
      disposed: number;  
      imminent: number;  
      critical: number;  
      healthy: number;
      no_expiry: number;
    };
  };

  production: {
    planQty: number;
    futurePlanQty: number;
    receivedQty: number;      
    achievementRate: number;  
    lastReceivedDate: string | null;
  };

  unfulfilledOrders: UnfulfilledOrder[];
}

export interface CustomerStat {
  id: string;             
  name: string;           
  orderCount: number;     
  fulfilledCount: number; 
  totalRevenue: number;   
  missedRevenue: number;  
  fulfillmentRate: number;
  topBoughtProducts: { 
    name: string; 
    value: number; 
    qty: number; 
    unit: string; 
    umrezBox: number; 
  }[]; 
  unfulfilledDetails: UnfulfilledOrder[]; 
}

export interface FulfillmentAnalysis {
  summary: {
    totalOrders: number;
    fulfilledOrders: number;
    unfulfilledCount: number;
    totalCustomers: number;
    averageRate: number;
  };
  byCustomer: CustomerStat[];
}

export interface DashboardAnalysis {
  kpis: {
    productSales: number;         
    merchandiseSales: number;     
    overallFulfillmentRate: string; 
    totalUnfulfilledValue: number;  
    criticalDeliveryCount: number;  
  };
  stockHealth: {
    disposed: number; 
    imminent: number;
    critical: number;
    healthy: number;  
    no_expiry: number;
  };
  salesAnalysis: {
    topProducts: { name: string; value: number }[];   
    topCustomers: { name: string; value: number }[];  
  };
  integratedArray: IntegratedItem[];
  fulfillment: FulfillmentAnalysis;
  productionList: ProductionRow[];
  /** 재고금액에 쓰인 기말재고 단가의 기준월 (예: '2026년 6월 기말') */
  priceAsOfLabel: string;
}
