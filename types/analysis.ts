// types/analysis.ts
import { SapOrder, SapInventory, SapProduction } from './sap';

export interface InventoryBatch {
  quantity: number;       
  expirationDate: string; 
  remainDays: number;     
  remainRate: number;     
  location: string;       
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
    status: 'healthy' | 'critical' | 'imminent' | 'disposed'; 
    remainingDays: number;    
    riskScore: number;        
    ads: number;              
    recommendedStock: number; 
    batches: InventoryBatch[];
    // ✅ [핵심 수정] 상태별 수량을 쪼개서 저장하는 필드 추가
    statusBreakdown: {
      disposed: number;  // 폐기 대상 수량 (예: 46,400)
      imminent: number;  // 임박 수량
      critical: number;  // 긴급 수량
      healthy: number;   // 양호 수량 (예: 45,310)
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
  };
  salesAnalysis: {
    topProducts: { name: string; value: number }[];   
    topCustomers: { name: string; value: number }[];  
  };
  integratedArray: IntegratedItem[];
  fulfillment: FulfillmentAnalysis; 
  productionList: ProductionRow[]; 
}