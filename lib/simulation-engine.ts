// lib/simulation-engine.ts
import { addDays, format, parseISO, isAfter, startOfDay } from 'date-fns';

export interface SimulationParams {
  productName: string;
  minShelfLife: number;    // 최소 잔여 유통기한
  additionalQty: number;   // 추가 납품 요청 수량 (신규)
  targetDate: string;      // 추가 납품 요청일 (YYYY-MM-DD)
}

export interface InventoryEvent {
  date: string;
  type: 'STOCK' | 'PRODUCTION' | 'EXISTING_ORDER' | 'NEW_REQUEST';
  qty: number;
  balance: number; // 그날의 마감 재고
}

export interface SimulationResult {
  isPossible: boolean;         // 납품 가능 여부
  shortageDate: string | null; // 결품 발생일
  shortageQty: number;         // 부족 수량
  timeline: InventoryEvent[];  // 일자별 변동 내역
  currentUsableStock: number;  // 기초 유효 재고
  totalProduction: number;     // 기간 내 총 생산
  committedDemand: number;     // 기간 내 총 기수요
}

export function runDailySimulation(
  batches: any[],       // 현재 보유 재고 (Batches)
  production: any[],    // 생산 계획 (Supply)
  orders: any[],        // 기존 수주 (Committed Demand)
  params: SimulationParams
): SimulationResult {
  
  // 1. 기준일 설정 (오늘 00:00:00)
  const today = startOfDay(new Date()); 
  
  // 날짜별 이벤트 집계 맵
  const timelineMap = new Map<string, { prod: number; existingOrder: number; newReq: number }>();

  // 2. 기초 유효 재고 계산
  let currentUsableStock = 0;
  batches.forEach(b => {
    let expDate = parseISO(b.VFDAT); 
    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= params.minShelfLife) {
      currentUsableStock += Number(b.CLABS);
    }
  });

  // 3. 이벤트 매핑 (날짜별 합산)
  
  // (A) 생산 계획
  production.forEach(p => {
    const date = p.GSTRP;
    if (!date) return;
    if (!timelineMap.has(date)) timelineMap.set(date, { prod: 0, existingOrder: 0, newReq: 0 });
    timelineMap.get(date)!.prod += Number(p.PSMNG);
  });

  // (B) 기존 주문 (기수요)
  let totalCommittedDemand = 0;
  orders.forEach(o => {
    const date = o.VDATU;
    if (!date) return;
    if (!timelineMap.has(date)) timelineMap.set(date, { prod: 0, existingOrder: 0, newReq: 0 });
    timelineMap.get(date)!.existingOrder += Number(o.KWMENG);
    totalCommittedDemand += Number(o.KWMENG);
  });

  // (C) 신규 요청 (시뮬레이션 대상)
  if (params.additionalQty > 0 && params.targetDate) {
    const date = params.targetDate;
    if (!timelineMap.has(date)) timelineMap.set(date, { prod: 0, existingOrder: 0, newReq: 0 });
    timelineMap.get(date)!.newReq += params.additionalQty;
  }

  // 4. 타임라인 시뮬레이션
  const timeline: InventoryEvent[] = [];
  let currentBalance = currentUsableStock;
  
  let shortageDate: string | null = null;
  let minBalance = 0;
  let totalProduction = 0;

  // 종료일 계산
  const sortedDates = Array.from(timelineMap.keys()).sort();
  const lastEventDateStr = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : format(addDays(today, 30), 'yyyy-MM-dd');
  const endDate = startOfDay(parseISO(lastEventDateStr)); 
  
  let checkDate = today;

  // 시작점 기록
  timeline.push({ 
    date: format(today, 'yyyy-MM-dd'), 
    type: 'STOCK', 
    qty: currentUsableStock, 
    balance: currentBalance 
  });

  // 일자별 순회
  while (!isAfter(checkDate, endDate)) {
    const dateStr = format(checkDate, 'yyyy-MM-dd');
    const events = timelineMap.get(dateStr);

    if (events) {
      // 순서: 생산 입고(+) -> 기수요 차감(-) -> 신규 요청 차감(-)
      
      if (events.prod > 0) {
        currentBalance += events.prod;
        totalProduction += events.prod;
        timeline.push({ date: dateStr, type: 'PRODUCTION', qty: events.prod, balance: currentBalance });
      }

      if (events.existingOrder > 0) {
        currentBalance -= events.existingOrder;
        // 기수요 처리 후 마이너스면 이미 결품 상태
        if (currentBalance < 0 && !shortageDate) {
          shortageDate = dateStr;
          minBalance = currentBalance;
        }
        timeline.push({ date: dateStr, type: 'EXISTING_ORDER', qty: -events.existingOrder, balance: currentBalance });
      }

      if (events.newReq > 0) {
        currentBalance -= events.newReq;
        // 신규 요청 처리 후 마이너스면 불가 판정
        if (currentBalance < 0 && !shortageDate) {
          shortageDate = dateStr;
          minBalance = currentBalance;
        }
        timeline.push({ date: dateStr, type: 'NEW_REQUEST', qty: -events.newReq, balance: currentBalance });
      }
    }

    checkDate = addDays(checkDate, 1);
  }

  return {
    isPossible: shortageDate === null,
    shortageDate,
    shortageQty: Math.abs(minBalance),
    timeline,
    currentUsableStock,
    totalProduction,
    committedDemand: totalCommittedDemand
  };
}