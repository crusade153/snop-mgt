// SAP 판매 오더 데이터 타입 정의
export interface SapOrder {
  AUART: string;        // 주문 유형 (예: ZO11)
  BEZEI_TVAKT: string;  // 주문 유형 명 (예: EDI일반오더)
  VBELN: string;        // 판매 문서 번호 (Key)
  POSNR: string;        // 품목 번호
  VKORG: string;        // 영업 조직
  VTEXT_TVKOT: string;  // 영업 조직 명 (예: (주)하림산업)
  
  // 고객 정보
  KUNNR: string;        // 판매처 번호
  NAME1: string;        // 판매처 명 (예: GS리테일...)
  
  // 물류 정보
  LGORT: string;        // 저장 위치
  LGOBE: string;        // 저장 위치 명
  LGORT_LIPS: string | null; // (Nullable) 출하 저장 위치
  
  // 날짜 및 기타
  VDATU: string;        // 납품 요청일 (YYYYMMDD)
  // ... 필요한 필드 추가
}