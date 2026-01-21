// store/snop-store.ts
import { create } from 'zustand';

export interface SnopItem {
  period: string;    // 표시용 라벨 (예: "W4" 또는 "01-21")
  fullDate: string;  // 정렬/로직용 날짜 키
  boh: number;       // 기초재고
  demand: number;    // 판매
  supply: number;    // 생산
  eoh: number;       // 기말재고
  status: 'OK' | 'SHORTAGE' | 'EXCESS';
}

interface SnopState {
  productName: string;
  productCode: string; // ✅ [추가] 제품 코드
  startStock: number;
  items: SnopItem[];
  
  // setInitialData 인자 수정: name, code, stock, data
  setInitialData: (name: string, code: string, currentStock: number, rawData: any[]) => void;
  updateCell: (index: number, type: 'demand' | 'supply', value: number) => void;
  reset: () => void;
}

const recalculate = (items: SnopItem[], startStock: number) => {
  let currentStock = startStock;
  
  return items.map(item => {
    const boh = currentStock;
    const eoh = boh + item.supply - item.demand;
    
    let status: 'OK' | 'SHORTAGE' | 'EXCESS' = 'OK';
    if (eoh < 0) status = 'SHORTAGE';
    else if (eoh > 20000) status = 'EXCESS'; 

    currentStock = eoh; 

    return { ...item, boh, eoh, status };
  });
};

export const useSnopStore = create<SnopState>((set, get) => ({
  productName: '',
  productCode: '',
  startStock: 0,
  items: [],

  setInitialData: (name, code, currentStock, rawData) => {
    const initialItems: SnopItem[] = rawData.map(d => ({
      period: d.periodLabel,
      fullDate: d.dateKey,
      boh: 0,
      demand: d.demand,
      supply: d.supply,
      eoh: 0,
      status: 'OK'
    }));

    const calculated = recalculate(initialItems, currentStock);
    set({ productName: name, productCode: code, startStock: currentStock, items: calculated });
  },

  updateCell: (index, type, value) => {
    const { items, startStock } = get();
    const newItems = [...items];
    newItems[index][type] = value;
    const recalculated = recalculate(newItems, startStock);
    set({ items: recalculated });
  },

  reset: () => set({ productName: '', productCode: '', startStock: 0, items: [] }),
}));