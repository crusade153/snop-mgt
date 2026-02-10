// types/analysis.ts
import { SapOrder, SapInventory, SapProduction, FbhInventory } from './sap';

export interface InventoryBatch {
  quantity: number;       
  expirationDate: string; 
  remainDays: number;     
  remainRate: number;     
  location: string;
  source: 'PLANT' | 'FBH';
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

    batches: InventoryBatch[]; 
    
    plantBatches: InventoryBatch[];
    fbhBatches: InventoryBatch[];
    
    status: 'healthy' | 'critical' | 'imminent' | 'disposed' | 'no_expiry'; 
    remainingDays: number;    
    riskScore: number;        
    
    ads: number; // 기존 호환용 (기본 60일)
    ads30: number; // 최근 30일 기준 일평균 판매량
    ads60: number; // 최근 60일 기준 일평균 판매량
    ads90: number; // 최근 90일 기준 일평균 판매량

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
}