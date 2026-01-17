// lib/simulation-engine.ts
import { addDays, format, parseISO, isAfter, startOfDay } from 'date-fns';

export interface SimulationParams {
  productName: string;
  minShelfLife: number;    // 최소 잔여 유통기한
  additionalQty: number;   // 추가 납품 요청 수량
  targetDate: string;      // 추가 납품 요청일 (YYYY-MM-DD)
}

export interface InventoryEvent {
  date: string;
  type: 'STOCK' | 'PRODUCTION' | 'ORDER' | 'NEW_REQUEST';
  qty: number;
  balance: number; // 그날의 재고 잔고
}

export interface SimulationResult {
  isPossible: boolean;     // 가능 여부
  shortageDate: string | null; // 부족 발생일
  shortageQty: number;     // 부족 수량
  timeline: InventoryEvent[]; // 일자별 변동 내역
  currentUsableStock: number; // 유효 재고
  totalProduction: number;    // 기간 내 총 생산
}

export function runDailySimulation(
  batches: any[],       // 재고 배치
  production: any[],    // 생산 계획
  orders: any[],        // 기존 주문
  params: SimulationParams
): SimulationResult {
  
  // ✅ [수정] 시간 정보를 제거하고 '오늘 00:00:00'으로 초기화 (버그 해결 핵심)
  const today = startOfDay(new Date()); 
  const timelineMap = new Map<string, { prod: number; order: number; newReq: number }>();

  // 1. 유효 재고 계산
  let currentUsableStock = 0;
  batches.forEach(b => {
    const expDate = parseISO(b.VFDAT);
    const diffTime = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays >= params.minShelfLife) {
      currentUsableStock += Number(b.CLABS);
    }
  });

  // 2. 이벤트 매핑
  production.forEach(p => {
    const date = p.GSTRP; 
    if (!timelineMap.has(date)) timelineMap.set(date, { prod: 0, order: 0, newReq: 0 });
    timelineMap.get(date)!.prod += Number(p.PSMNG);
  });

  orders.forEach(o => {
    const date = o.VDATU;
    if (!timelineMap.has(date)) timelineMap.set(date, { prod: 0, order: 0, newReq: 0 });
    timelineMap.get(date)!.order += Number(o.KWMENG);
  });

  if (params.additionalQty > 0 && params.targetDate) {
    const date = params.targetDate;
    if (!timelineMap.has(date)) timelineMap.set(date, { prod: 0, order: 0, newReq: 0 });
    timelineMap.get(date)!.newReq += params.additionalQty;
  }

  // 3. 타임라인 시뮬레이션
  const timeline: InventoryEvent[] = [];
  let currentBalance = currentUsableStock;
  let shortageDate: string | null = null;
  let minBalance = 0;
  let totalProduction = 0;

  // 날짜 정렬
  const sortedDates = Array.from(timelineMap.keys()).sort();
  
  // 시뮬레이션 종료일: 가장 늦은 이벤트 날짜 or 오늘로부터 30일 뒤
  const lastEventDateStr = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : format(addDays(today, 30), 'yyyy-MM-dd');
  // ✅ [수정] 종료일도 00:00:00으로 정확히 파싱
  const endDate = startOfDay(parseISO(lastEventDateStr)); 
  
  let checkDate = today;

  // ✅ [수정] 날짜 비교 로직 강화 (checkDate <= endDate 동안 반복)
  while (!isAfter(checkDate, endDate)) {
    const dateStr = format(checkDate, 'yyyy-MM-dd');
    const events = timelineMap.get(dateStr);

    // 이벤트가 있는 날만 계산 및 기록
    if (events) {
      if (events.prod > 0) {
        currentBalance += events.prod;
        totalProduction += events.prod;
        timeline.push({ date: dateStr, type: 'PRODUCTION', qty: events.prod, balance: currentBalance });
      }
      if (events.order > 0) {
        currentBalance -= events.order;
        timeline.push({ date: dateStr, type: 'ORDER', qty: -events.order, balance: currentBalance });
      }
      if (events.newReq > 0) {
        currentBalance -= events.newReq;
        timeline.push({ date: dateStr, type: 'NEW_REQUEST', qty: -events.newReq, balance: currentBalance });
      }
    } else {
        // 이벤트가 없는 날도 그래프를 위해 시작점/끝점 등에는 점을 찍어주는 것이 좋음 (선택사항)
        // 여기서는 데이터 포인트가 너무 많아지는걸 방지하기 위해 생략하되,
        // 시각적으로 그래프가 뚝 끊기지 않게 로직 유지
    }

    // 결품 체크 (마이너스 발생 시점 기록)
    if (currentBalance < 0 && !shortageDate) {
      shortageDate = dateStr;
      minBalance = currentBalance;
    }

    checkDate = addDays(checkDate, 1);
  }

  // ✅ [수정] 시작점에 현재 재고 포인트 추가 (그래프가 0일부터 시작되도록)
  if (timeline.length > 0 && timeline[0].date !== format(today, 'yyyy-MM-dd')) {
      timeline.unshift({ date: format(today, 'yyyy-MM-dd'), type: 'STOCK', qty: 0, balance: currentUsableStock });
  } else if (timeline.length === 0) {
      // 이벤트가 하나도 없어도 현재 재고선은 보여줌
      timeline.push({ date: format(today, 'yyyy-MM-dd'), type: 'STOCK', qty: 0, balance: currentUsableStock });
      timeline.push({ date: format(addDays(today, 30), 'yyyy-MM-dd'), type: 'STOCK', qty: 0, balance: currentUsableStock });
  }

  return {
    isPossible: shortageDate === null,
    shortageDate,
    shortageQty: Math.abs(minBalance),
    timeline,
    currentUsableStock,
    totalProduction
  };
}