// lib/snop-aggregation.ts
import { SapOrder, SapInventory, SapProduction } from '@/types/sap';
import { getISOWeek, parseISO } from 'date-fns';

export interface SnopData {
  week: string;
  matnr: string;
  matnr_t: string;
  demand: number;
  supply: number;
  inventory: number;
}

// ⚠️ 이 함수 앞에 'export' 키워드가 꼭 있어야 합니다!
export function aggregateData(
  orders: SapOrder[],
  inventory: SapInventory[],
  production: SapProduction[]
): SnopData[] {
  const aggregated = new Map<string, SnopData>();

  // 1. 판매 오더 (수요)
  orders.forEach(order => {
    if (!order.VDATU || order.VDATU.length !== 8) return; 
    
    const dateStr = `${order.VDATU.slice(0,4)}-${order.VDATU.slice(4,6)}-${order.VDATU.slice(6,8)}`;
    const date = parseISO(dateStr);
    const week = `W${getISOWeek(date)}`;
    const key = `${week}-${order.MATNR}`;

    const existing = aggregated.get(key) || {
      week,
      matnr: order.MATNR,
      matnr_t: order.ARKTX || '', 
      demand: 0,
      supply: 0,
      inventory: 0
    };

    existing.demand += order.KWMENG || 0;
    aggregated.set(key, existing);
  });

  // 2. 생산 계획 (공급)
  production.forEach(prod => {
    if (!prod.GSTRP || prod.GSTRP.length !== 8) return;

    const dateStr = `${prod.GSTRP.slice(0,4)}-${prod.GSTRP.slice(4,6)}-${prod.GSTRP.slice(6,8)}`;
    const date = parseISO(dateStr);
    const week = `W${getISOWeek(date)}`;
    const key = `${week}-${prod.MATNR}`;

    const existing = aggregated.get(key) || {
      week,
      matnr: prod.MATNR,
      matnr_t: prod.MAKTX || '',
      demand: 0,
      supply: 0,
      inventory: 0
    };

    existing.supply += prod.PSMNG || 0;
    aggregated.set(key, existing);
  });

  return Array.from(aggregated.values()).sort((a, b) => a.week.localeCompare(b.week));
}