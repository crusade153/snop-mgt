// lib/snop-aggregation.ts
import { SapOrder, SapProduction } from '@/types/sap';
import { getISOWeek, parseISO, format } from 'date-fns';

export interface AggregatedData {
  dateKey: string;     // YYYYMMDD or YYYY-Wxx
  periodLabel: string; // 화면 표시용 (MM-DD or Wxx)
  demand: number;
  supply: number;
}

export function aggregateData(
  orders: SapOrder[],
  production: SapProduction[],
  mode: 'WEEK' | 'DAY'
): Map<string, AggregatedData> {
  
  const map = new Map<string, AggregatedData>();

  // Helper: 키 생성기
  const getKey = (dateStr: string) => { // YYYYMMDD 입력
    if (!dateStr || dateStr.length !== 8) return null;
    const date = parseISO(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`);
    
    if (mode === 'WEEK') {
      const week = getISOWeek(date);
      return { key: `W${week}`, label: `W${week}` };
    } else {
      return { key: dateStr, label: format(date, 'MM-dd') };
    }
  };

  // 1. 판매 (Demand)
  orders.forEach(o => {
    const k = getKey(o.VDATU);
    if (!k) return;
    
    if (!map.has(k.key)) map.set(k.key, { dateKey: k.key, periodLabel: k.label, demand: 0, supply: 0 });
    map.get(k.key)!.demand += o.KWMENG || 0;
  });

  // 2. 생산 (Supply)
  production.forEach(p => {
    const k = getKey(p.GSTRP);
    if (!k) return;

    if (!map.has(k.key)) map.set(k.key, { dateKey: k.key, periodLabel: k.label, demand: 0, supply: 0 });
    map.get(k.key)!.supply += p.PSMNG || 0;
  });

  return map;
}