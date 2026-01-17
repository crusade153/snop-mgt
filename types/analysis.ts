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
 * 📝 미납 주문 상세 정보 (공통 사용)
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
 * 📊 통합된 아이템 구조 (IntegratedItem)
 */
export interface IntegratedItem {
  // --- 기본 정보 ---
  code: string;       
  name: string;       
  unit: string;       
  brand: string;      
  category: string;   
  family: string;     
  
  // --- KPI 집계 ---
  totalReqQty: number;           
  totalActualQty: number;        
  totalUnfulfilledQty: number;   
  totalUnfulfilledValue: number; 
  totalSalesAmount: number;      

  // --- 📦 재고 분석 정보 ---
  inventory: {
    totalStock: number;       
    usableStock: number;      
    
    // 🚨 [수정] status 타입에 'imminent' 추가
    status: 'healthy' | 'critical' | 'imminent' | 'disposed'; 
    remainingDays: number;    
    riskScore: number;        
    ads: number;              
    recommendedStock: number; 
    
    batches: InventoryBatch[]; 
  };

  // --- 🏭 생산 분석 정보 ---
  production: {
    planQty: number;          
    receivedQty: number;      
    achievementRate: number;  
    lastReceivedDate: string | null;
    nextPlanDate?: string;    
  };

  // --- 🚚 미납 상세 리스트 (제품 기준) ---
  unfulfilledOrders: UnfulfilledOrder[];
}

/**
 * 🏢 거래처별 통계
 */
export interface CustomerStat {
  id: string;             // 거래처 코드
  name: string;           // 거래처명
  orderCount: number;     // 총 주문 라인 수
  fulfilledCount: number; // 완전 납품 건수
  totalRevenue: number;   // 총 매출액
  missedRevenue: number;  // 미납으로 인한 손실액
  fulfillmentRate: number;// 납품 준수율 (%)
  
  topBoughtProducts: { name: string; value: number; qty: number }[]; // 많이 산 제품 Top 10
  unfulfilledDetails: UnfulfilledOrder[]; // 이 거래처의 미납 건들
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
 * 📈 대시보드 최종 리턴 데이터 (DashboardAnalysis)
 */
export interface DashboardAnalysis {
  kpis: {
    productSales: number;         
    merchandiseSales: number;     
    overallFulfillmentRate: string; 
    totalUnfulfilledValue: number;  
    criticalDeliveryCount: number;  
  };

  // 🚨 [수정] stockHealth 타입에 'imminent' 추가
  stockHealth: {
    disposed: number; 
    imminent: number; // 임박 (0~30일)
    critical: number; // 긴급 (30~60일)
    healthy: number;  
  };

  salesAnalysis: {
    topProducts: { name: string; value: number }[];   
    topCustomers: { name: string; value: number }[];  
  };

  integratedArray: IntegratedItem[];
  fulfillment: FulfillmentAnalysis; 
}