import { create } from 'zustand';
import { format, startOfMonth } from 'date-fns';

interface DateState {
  startDate: string;
  endDate: string;
  // 날짜 변경 함수
  setRange: (start: string, end: string) => void;
}

export const useDateStore = create<DateState>((set) => ({
  // 기본값: 이번 달 1일 ~ 오늘
  startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
  endDate: format(new Date(), 'yyyy-MM-dd'),
  
  setRange: (startDate, endDate) => set({ startDate, endDate }),
}));