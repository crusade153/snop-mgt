/**
 * 📘 SAP & FBH Data Type Definitions
 * * BigQuery 데이터 매핑용 타입 정의 (Updated v3.0 - FBH 통합)
 */

import type { PriceSource } from '@/lib/ending-inventory-price';

// 1. 판매 오더 (Sales Order)
export interface SapOrder {
  VBELN: string;        // 판매 문서 번호
  POSNR: string;        // 품목 번호
  AUART: string;        // 주문 유형
  BEZEI_TVAKT?: string; // 주문 유형 설명
  LGORT?: string;       // 🚨 저장 위치 코드 (추가)
  LGOBE?: string;       // 저장 위치 명
  WERKS?: string;       // 🚨 플랜트 (추가)
  KUNNR: string;        // 판매처 번호
  NAME1: string;        // 판매처 명
  KUNNR_WE?: string;    // 납품처 번호
  NAME1_KUNNR_WE?: string; // 납품처 명
  VDATU: string;        // 납품 요청일
  AUDAT_VBAK?: string;  // 주문일
  MATNR: string;        // 자재 번호
  ARKTX: string;        // 자재 내역(상품명)
  KWMENG: number;       // 주문 수량
  VRKME: string;        // 판매 단위
  LFIMG_LIPS?: number;  // 실 납품 수량
  NETWR: number;        // 금액
  WAERK?: string;       // 통화
  UMREZ_BOX?: number;   // 박스 입수량
  MEINS?: string;       // 기준 단위
}

// 2. 사내 플랜트 재고 (Plant Inventory)
export interface SapInventory {
  MATNR: string;        // 자재 번호
  MATNR_T: string;      // 자재 내역
  WERKS?: string;       // 플랜트
  DISPO?: string;       // MRP 관리자(재고 용도/생산라인 구분)
  MEINS: string;        // 기본 단위
  CLABS: number;        // 가용 재고
  CINSM?: number;       // 품질 대기 재고
  VFDAT: string;        // 유통기한
  LGOBE: string;        // 저장 위치 명
  remain_day: number;   // 잔여 일수
  remain_rate: number;  // 잔여율
  UMREZ_BOX: number;    // 환산 분모
  VALUATION_UNIT_PRICE?: number; // 기말재고 단가 (ending_inventory)
  STOCK_VALUE?: number;          // 가용 재고 평가금액
  QUALITY_STOCK_VALUE?: number;  // 품질 재고 평가금액
  PRICE_SOURCE?: PriceSource;    // 단가 출처(당월생산 판별용)
  PRDHA_1_T?: string;   // 브랜드
  PRDHA_2_T?: string;   // 카테고리
  PRDHA_3_T?: string;   // 제품군
}

// 3. 생산 계획 (Production)
export interface SapProduction {
  AUFNR: string;        // 생산 오더 번호
  MATNR: string;        // 자재 번호
  MAKTX: string;        // 자재 내역
  GSTRP: string;        // 계획 시작일
  WERKS: string;        // 플랜트
  PSMNG: number;        // 계획 수량
  LMNGA: number;        // 실적 수량
  MEINS: string;        // 단위
  UMREZ_BOX?: number;   
}

// 3-1. 완제품·상품의 생산투입 소요 (MM_MB51 BWART 261 투입 - 262 취소)
// 스프·양념장처럼 '제품 코드로 등록됐지만 다른 제품의 자재로 다시 투입되는' 품목의 실소요다.
export interface SapProductConsumption {
  MATNR: string;    // 자재 번호
  BUDAT: string;    // 전기일 (YYYYMMDD)
  NET_QTY: number;  // 261 - 262 순투입량, 기본단위(EA/KG) 환산
}

// ✅ [신규] 4. 외부 창고 재고 (FBH Inventory)
export interface FbhInventory {
  SKU_CD: string;             // 자재코드 (MATNR 대응)
  MATNR_T: string;            // 자재명
  PRDT_DATE_NEW: string;      // 제조일자 (YYYYMMDD or YYYY-MM-DD)
  VALID_DATETIME_NEW: string; // 소비기한 (YYYYMMDD or YYYY-MM-DD)
  AVLB_QTY: number;           // 가용수량
  MEINS: string;              // 기본 단위 (EA)
  UMREZ_BOX: number;          // 입수량 (분자)
  REMAINING_DAY: number;      // 잔여기간
  VALUATION_UNIT_PRICE?: number; // 기말재고 단가 (ending_inventory)
  STOCK_VALUE?: number;          // 가용 재고 평가금액
  PRICE_SOURCE?: PriceSource;    // 단가 출처(당월생산 판별용)
}
