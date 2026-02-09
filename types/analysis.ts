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
    
    // ✅ [복구] 가용 재고 필드 추가 (빌드 에러 해결)
    usableStock: number;

    plantStock: number; 
    fbhStock: number;   

    batches: InventoryBatch[]; 
    
    plantBatches: InventoryBatch[];
    fbhBatches: InventoryBatch[];
    
    status: 'healthy' | 'critical' | 'imminent' | 'disposed' | 'no_expiry'; 
    remainingDays: number;    
    riskScore: number;        
    ads: number;              
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