import { SapInventory, SapOrder, SapProduction } from './sap';

/**
 * 📦 재고 배치(Batch) 정보
 * : 같은 품목이라도 유통기한/창고위치에 따라 구분되는 상세 재고 단위
 */
export interface InventoryBatch {
  quantity: number;       // 수량
  expirationDate: string; // 유통기한 (YYYY-MM-DD)
  remainDays: number;     // 잔여일수
  remainRate: number;     // 🆕 추가됨: 잔여율(%)
  location: string;       // 창고명 (LGOBE)
}

/**
 * 📊 통합된 아이템 구조 (IntegratedItem)
 * : 납품, 재고, 생산 정보를 품목(Material) 단위로 하나로 합친 객체입니다.
 */
export interface IntegratedItem {
  // --- 기본 정보 ---
  code: string;       // 자재코드 (MATNR)
  name: string;       // 제품명
  unit: string;       // 단위
  brand: string;      // 브랜드 (예: 하림)
  category: string;   // 카테고리 (예: 상온)
  family: string;     // 제품군 (예: 즉석밥)
  
  // --- KPI 집계 (매출/미납) ---
  totalReqQty: number;           // 총 요청 수량
  totalActualQty: number;        // 총 실 납품 수량
  totalUnfulfilledQty: number;   // 총 미납 수량
  totalUnfulfilledValue: number; // 총 미납 금액 (손실액)
  totalSalesAmount: number;      // 총 매출액

  // --- 📦 재고 분석 정보 (고도화됨) ---
  inventory: {
    totalStock: number;       // 물리적 총 재고
    usableStock: number;      // (시뮬레이션용) 유효 가용 재고
    
    status: 'healthy' | 'critical' | 'disposed'; // 대표 상태
    remainingDays: number;    // 대표 잔여일수 (가장 임박한 것 기준)
    riskScore: number;        // 위험도 점수
    ads: number;              // 일평균 판매량 (Velocity)
    recommendedStock: number; // 적정 재고 권장량
    
    // 👇 [핵심] 유통기한별 상세 배치 리스트
    batches: InventoryBatch[]; 
  };

  // --- 🏭 생산 분석 정보 ---
  production: {
    planQty: number;          // 계획 수량
    receivedQty: number;      // 입고 실적
    achievementRate: number;  // 달성률 (%)
    lastReceivedDate: string | null; // 최근 입고일
    nextPlanDate?: string;    // 다음 생산 계획일
  };

  // --- 🚚 미납 상세 리스트 (Drill-down용) ---
  unfulfilledOrders: UnfulfilledOrder[];
}

/**
 * 📝 미납 주문 상세 정보
 */
export interface UnfulfilledOrder {
  place: string;       // 납품처 (고객명)
  qty: number;         // 미납 수량
  value: number;       // 미납 금액
  unitPrice: number;   // 단가
  reqDate: string;     // 납품 요청일
  daysDelayed: number; // 지연 일수
  cause: string;       // 원인 (재고부족 / 생산차질 / 물류지연)
}

/**
 * 🏢 거래처별 통계 (CustomerStat)
 * : 납품 현황 페이지에서 사용
 */
export interface CustomerStat {
  id: string;             // 거래처 코드
  name: string;           // 거래처명
  orderCount: number;     // 총 주문 라인 수
  fulfilledCount: number; // 완전 납품 건수
  totalRevenue: number;   // 총 매출액
  missedRevenue: number;  // 미납으로 인한 손실액
  fulfillmentRate: number;// 납품 준수율 (%)
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
 * : 클라이언트로 전송되는 최종 데이터 구조
 */
export interface DashboardAnalysis {
  // 상단 KPI 카드 데이터
  kpis: {
    productSales: number;         // 제품 매출
    merchandiseSales: number;     // 상품 매출
    overallFulfillmentRate: string; // 전체 생산 달성률
    totalUnfulfilledValue: number;  // 총 미납 손실액
    criticalDeliveryCount: number;  // 긴급 납품 건수
  };

  // 재고 건전성 요약
  stockHealth: {
    disposed: number; // 폐기
    critical: number; // 긴급
    healthy: number;  // 양호
  };

  // 매출 랭킹 데이터
  salesAnalysis: {
    byBrand: { name: string; value: number }[];
    byCategory: { name: string; value: number }[];
    byFamily: { name: string; value: number }[];
  };

  // 전체 통합 데이터 리스트 (핵심)
  integratedArray: IntegratedItem[];

  // 납품 현황 분석 데이터
  fulfillment: FulfillmentAnalysis; 
}