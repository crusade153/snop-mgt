import { create } from 'zustand';

type UnitMode = 'BASE' | 'BOX'; 
// ✅ [변경] 명칭 변경: FBH -> LOGISTICS (물류센터)
type InventoryViewMode = 'ALL' | 'PLANT' | 'LOGISTICS';

interface UiState {
  unitMode: UnitMode;
  inventoryViewMode: InventoryViewMode;
  
  toggleUnitMode: () => void;
  setUnitMode: (mode: UnitMode) => void;
  setInventoryViewMode: (mode: InventoryViewMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  unitMode: 'BASE', 
  inventoryViewMode: 'ALL', // 기본값은 통합 보기
  
  toggleUnitMode: () => set((state) => ({ 
    unitMode: state.unitMode === 'BASE' ? 'BOX' : 'BASE' 
  })),

  setUnitMode: (mode) => set({ unitMode: mode }),
  
  setInventoryViewMode: (mode) => set({ inventoryViewMode: mode }),
}));