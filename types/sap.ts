/**
 * 📘 SAP Data Type Definitions for Harim Nexus S&OP
 * * 이 파일은 BigQuery에 적재된 SAP 테이블(SD, MM, PP)의 스키마를 정의합니다.
 * 실제 데이터 진단(Debug) 결과를 바탕으로, S&OP 의사결정에 필요한 핵심 컬럼 위주로 매핑되었습니다.
 * * @version 1.0.0
 * @lastUpdated 2025-01-27
 */

// =============================================================================
// 1. 판매 오더 (Sales Order) - SD_ZASSDDV0020
// * Source: image_1f6a70.png (2025-01-27 Verified)
// =============================================================================
export interface SapOrder {
  // --- 오더 식별 ---
  VBELN: string;        // 판매 문서 번호 (Sales Document No) - Key
  POSNR: string;        // 품목 번호 (Item No) - Key
  AUART: string;        // 주문 유형 코드 (예: ZF01, ZO11)
  BEZEI_TVAKT: string;  // 주문 유형 명 (예: 무상오더, 일반판매오더)
  BSTKD: string;        // 참조 문서/PO 번호 (예: 8월 1주차 대형마트 발주)

  // --- 고객 정보 ---
  KUNNR: string;        // 판매처(주문처) 번호 (Sold-to Party)
  NAME1: string;        // 판매처 명 (예: (주)이마트 안성점)
  KUNNR_WE: string;     // 납품처 번호 (Ship-to Party)
  NAME1_KUNNR_WE: string; // 납품처 명 (실제 물건 받는 곳)

  // --- 조직 및 물류 ---
  VKORG: string;        // 영업 조직 (예: 1000)
  VTEXT_TVKOT: string;  // 영업 조직 명 (예: (주)하림산업)
  VKGRP: string;        // 영업 그룹 (예: 170)
  BEZEI_TVGRT: string;  // 영업 그룹 명 (예: 매스채널팀)
  WERKS: string;        // 출하 플랜트 (예: 1031)
  NAME1_WERKS: string;  // 플랜트 명 (예: 하림산업 온라인물류센터)
  LGORT: string;        // 저장 위치 코드 (예: 3000)
  LGOBE: string;        // 저장 위치 명 (예: 물류창고)

  // --- 상품 및 수량 ---
  MATNR: string;        // 자재 번호 (Material No)
  ARKTX: string;        // 판매 자재 내역(상품명) (예: [TOTE] 하림 멕시칸 시식컵)
  KWMENG: number;       // 주문 수량 (Order Quantity)
  VRKME: string;        // 판매 단위 (예: EA)
  
  // --- 금액 정보 ---
  NETWR: number;        // 순 금액 (Net Value)
  WAERK: string;        // 통화 (예: KRW)

  // --- 일정 ---
  VDATU: string;        // 납품 요청일 (Req. Delivery Date, YYYYMMDD)
  AUDAT_VBAK: string;   // 증빙일/주문일 (Document Date)
}


// =============================================================================
// 2. 재고 현황 (Inventory) - V_MM_MCHB
// * Source: image_1f5f2a.png (2025-01-27 Verified)
// =============================================================================
export interface SapInventory {
  // --- 자재 정보 ---
  MATNR: string;        // 자재 번호 (Material Number, 예: 60000392)
  MATNR_T: string;      // 자재 내역 (상품명, 예: The미식고기물만두)
  MEINS: string;        // 기본 단위 코드 (Base Unit, 예: EA)
  C_MEINS: string;      // 기본 단위 명 (예: 식)
  
  // --- 분류 정보 (S&OP 집계용) ---
  PRDHA_1_T: string;    // 대분류 명 (예: The미식)
  PRDHA_2_T: string;    // 중분류 명 (예: The미식 만두)
  PRDHA_3_T: string;    // 소분류 명 (예: 고기물만두)
  
  // --- 창고 및 위치 ---
  LGORT: string;        // 저장 위치 코드 (예: 2101)
  LGOBE: string;        // 저장 위치 명 (예: 제품냉동자동창고)
  
  // --- 재고 수량 (핵심 KPI) ---
  CLABS: number;        // 가용 재고 (Unrestricted Stock) - 즉시 출고 가능
  CSPEM: number;        // 보류 재고 (Blocked Stock) - 문제 발생 등으로 잠김
  CINSM: number;        // 품질 검사 중 재고 (Quality Inspection)
  
  // --- 배치 및 유통기한 관리 ---
  CHARG: string;        // 배치 번호 (Batch Number)
  HSDAT: string;        // 제조일자 (Manufacture Date, YYYY-MM-DD)
  VFDAT: string;        // 유통기한 (Expiration Date, YYYY-MM-DD)
  
  // --- 분석 지표 ---
  remain_day: number;   // 잔여 유통기한 일수 (뷰 계산 필드)
  remain_rate: number;  // 잔여 기간 비율 (뷰 계산 필드)
  UMREZ_BOX: number;    // 박스 입수량 (Box Conversion Factor)
}


// =============================================================================
// 3. 생산 계획 및 실적 (Production) - PP_ZASPPR1110
// * Source: image_1f61f3.png (2025-01-27 Verified)
// =============================================================================
export interface SapProduction {
  // --- 오더 식별 ---
  AUFNR: string;        // 생산 오더 번호 (Order Number)
  AUART: string;        // 오더 유형 코드 (예: HR03)
  TXT: string;          // 오더 유형 설명 (예: [하림] 물류센터오더)
  
  // --- 자재 정보 ---
  MATNR: string;        // 자재 번호
  MAKTX: string;        // 자재 내역 (상품명, 예: 드라이아이스 600g)
  
  // --- 일정 및 장소 ---
  GSTRP: string;        // 계획 시작일 (Basic Start Date, YYYYMMDD)
  WERKS: string;        // 플랜트 코드 (예: 1031)
  ARBPL: string;        // 작업장 코드 (Work Center, 예: DRY_1010)
  KTEXT: string;        // 작업장 명 (예: 냉매제_드라이 작업장)
  
  // --- 수량 정보 (생산 KPI) ---
  PSMNG: number;        // 계획 수량 (Plan Quantity)
  LMNGA: number;        // 실적 수량 (Yield/Actual Quantity) - 생산 확정량
  WEMNG: number;        // 입고 수량 (Goods Receipt Quantity) - 창고 입고량
  MEINS: string;        // 단위 (예: EA)
  
  // --- 기타 관리 정보 ---
  VORNR: string;        // 공정 번호 (Operation Number, 예: 10)
  DISPO: string;        // MRP 관리자 (MRP Controller, 예: M35)
  LTXA1: string;        // 공정 텍스트 (예: 냉매제_드라이 작업장)
}