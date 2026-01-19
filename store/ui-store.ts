import { create } from 'zustand';

type UnitMode = 'BASE' | 'BOX'; // 기본단위 vs 박스단위

interface UiState {
  unitMode: UnitMode;
  toggleUnitMode: () => void;
  setUnitMode: (mode: UnitMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  unitMode: 'BASE', // 기본값: 기준 단위 (EA or KG)
  
  // 버튼 누를 때마다 모드 변경 (토글)
  toggleUnitMode: () => set((state) => ({ 
    unitMode: state.unitMode === 'BASE' ? 'BOX' : 'BASE' 
  })),

  setUnitMode: (mode) => set({ unitMode: mode }),
}));