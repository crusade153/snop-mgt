/**
 * 📘 SAP Data Type Definitions for Harim Nexus S&OP
 * * 이 파일은 BigQuery에 적재된 SAP 테이블(SD, MM, PP)의 스키마를 정의합니다.
 * 실제 데이터 진단(Debug) 결과를 바탕으로, S&OP 의사결정에 필요한 핵심 컬럼 위주로 매핑되었습니다.
 * * @version 1.1.0
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
  BEZEI_TVAKT?: string; // 주문 유형 명 (예: 무상오더, 일반판매오더) - *Optional로 변경 (Dashboard 쿼리에선 누락될 수 있음)
  BSTKD?: string;       // 참조 문서/PO 번호

  // --- 고객 정보 ---
  KUNNR: string;        // 판매처(주문처) 번호 (Sold-to Party)
  NAME1: string;        // 판매처 명 (예: (주)이마트 안성점)
  KUNNR_WE?: string;    // 납품처 번호 (Ship-to Party)
  NAME1_KUNNR_WE?: string; // 납품처 명 (실제 물건 받는 곳)

  // --- 조직 및 물류 ---
  VKORG?: string;       // 영업 조직
  VTEXT_TVKOT?: string; // 영업 조직 명
  VKGRP?: string;       // 영업 그룹
  BEZEI_TVGRT?: string; // 영업 그룹 명
  WERKS?: string;       // 출하 플랜트
  NAME1_WERKS?: string; // 플랜트 명
  LGORT?: string;       // 저장 위치 코드
  LGOBE?: string;       // 저장 위치 명

  // --- 상품 및 수량 ---
  MATNR: string;        // 자재 번호 (Material No)
  ARKTX: string;        // 판매 자재 내역(상품명)
  KWMENG: number;       // 주문 수량 (Order Quantity)
  VRKME: string;        // 판매 단위 (예: EA)
  
  // 🚨 [추가] 실 납품 수량 (미납 분석의 핵심)
  LFIMG_LIPS?: number;  // 실제 납품된 수량 (Actual Delivered Qty)

  // --- 금액 정보 ---
  NETWR: number;        // 순 금액 (Net Value)
  WAERK: string;        // 통화 (예: KRW)

  // --- 일정 ---
  VDATU: string;        // 납품 요청일 (Req. Delivery Date, YYYYMMDD)
  AUDAT_VBAK?: string;  // 증빙일/주문일 (Document Date)
}


// =============================================================================
// 2. 재고 현황 (Inventory) - V_MM_MCHB
// * Source: image_1f5f2a.png (2025-01-27 Verified)
// =============================================================================
export interface SapInventory {
  // --- 자재 정보 ---
  MATNR: string;        // 자재 번호
  MATNR_T: string;      // 자재 내역 (상품명)
  MEINS: string;        // 기본 단위 코드
  C_MEINS: string;      // 기본 단위 명
  
  // --- 분류 정보 ---
  PRDHA_1_T?: string;   // 대분류 명
  PRDHA_2_T?: string;   // 중분류 명
  PRDHA_3_T?: string;   // 소분류 명
  
  // --- 창고 및 위치 ---
  LGORT: string;        // 저장 위치 코드
  LGOBE: string;        // 저장 위치 명
  
  // --- 재고 수량 ---
  CLABS: number;        // 가용 재고 (Unrestricted Stock)
  CSPEM: number;        // 보류 재고
  CINSM: number;        // 품질 검사 중 재고
  
  // --- 배치 및 유통기한 ---
  CHARG: string;        // 배치 번호
  HSDAT: string;        // 제조일자
  VFDAT: string;        // 유통기한
  
  // --- 분석 지표 ---
  remain_day: number;   // 잔여 유통기한 일수
  remain_rate: number;  // 잔여 기간 비율
  UMREZ_BOX: number;    // 박스 입수량
}


// =============================================================================
// 3. 생산 계획 및 실적 (Production) - PP_ZASPPR1110
// * Source: image_1f61f3.png (2025-01-27 Verified)
// =============================================================================
export interface SapProduction {
  // --- 오더 식별 ---
  AUFNR: string;        // 생산 오더 번호
  AUART: string;        // 오더 유형 코드
  TXT: string;          // 오더 유형 설명
  
  // --- 자재 정보 ---
  MATNR: string;        // 자재 번호
  MAKTX: string;        // 자재 내역
  
  // --- 일정 및 장소 ---
  GSTRP: string;        // 계획 시작일
  WERKS: string;        // 플랜트 코드
  ARBPL: string;        // 작업장 코드
  KTEXT: string;        // 작업장 명
  
  // --- 수량 정보 ---
  PSMNG: number;        // 계획 수량
  LMNGA: number;        // 실적 수량
  WEMNG: number;        // 입고 수량
  MEINS: string;        // 단위
  
  // --- 기타 관리 정보 ---
  VORNR: string;        // 공정 번호
  DISPO: string;        // MRP 관리자
  LTXA1: string;        // 공정 텍스트
}