// types/analysis.ts
import { SapInventory, SapOrder, SapProduction } from './sap';

/**
 * 📦 재고 배치(Batch) 정보
 */
export interface InventoryBatch {
  quantity: number;       // 수량
  expirationDate: string; // 유통기한 (YYYY-MM-DD)
  remainDays: number;     // 잔여일수
  remainRate: number;     // 잔여율(%)
  location: string;       // 창고명 (LGOBE)
}

/**
 * 📝 미납 주문 상세 정보
 */
export interface UnfulfilledOrder {
  place: string;       // 납품처/거래처명
  productName: string; // 제품명
  qty: number;         // 미납 수량
  value: number;       // 미납 금액
  unitPrice: number;   // 단가
  reqDate: string;     // 납품 요청일
  daysDelayed: number; // 지연 일수
  cause: string;       // 원인
}

/**
 * 🏭 생산 상세 정보 (리스트용) - [Updated] Plant 추가
 */
export interface ProductionRow {
  date: string;       // 계획일 (GSTRP)
  plant: string;      // 🏭 플랜트 (WERKS) - 추가됨
  code: string;       // 자재코드
  name: string;       // 자재명
  unit: string;       // 단위
  planQty: number;    // 계획 수량
  actualQty: number;  // 실적 수량
  rate: number;       // 달성률
  status: 'pending' | 'progress' | 'completed' | 'poor'; // 상태
}

/**
 * 📊 통합된 아이템 구조 (IntegratedItem)
 */
export interface IntegratedItem {
  code: string;       
  name: string;       
  unit: string;       
  brand: string;      
  category: string;   
  family: string;     
  
  totalReqQty: number;           
  totalActualQty: number;        
  totalUnfulfilledQty: number;   
  totalUnfulfilledValue: number; 
  totalSalesAmount: number;      

  inventory: {
    totalStock: number;       
    usableStock: number;      
    status: 'healthy' | 'critical' | 'imminent' | 'disposed'; 
    remainingDays: number;    
    riskScore: number;        
    ads: number;              
    recommendedStock: number; 
    batches: InventoryBatch[]; 
  };

  production: {
    planQty: number;          
    receivedQty: number;      
    achievementRate: number;  
    lastReceivedDate: string | null;
    nextPlanDate?: string;    
  };

  unfulfilledOrders: UnfulfilledOrder[];
}

/**
 * 🏢 거래처별 통계
 */
export interface CustomerStat {
  id: string;             
  name: string;           
  orderCount: number;     
  fulfilledCount: number; 
  totalRevenue: number;   
  missedRevenue: number;  
  fulfillmentRate: number;
  
  topBoughtProducts: { name: string; value: number; qty: number }[]; 
  unfulfilledDetails: UnfulfilledOrder[]; 
}

/**
 * 📊 납품 분석 결과 래퍼
 */
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

/**
 * 📈 대시보드 최종 리턴 데이터
 */
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