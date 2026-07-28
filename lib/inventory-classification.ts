export type InventoryStockType = 'SELF' | 'SALE' | 'MERCHANDISE' | 'OTHER';
export type InventoryStockTypeFilter = 'ALL' | InventoryStockType;

export const INVENTORY_STOCK_TYPE_LABELS: Record<InventoryStockType, string> = {
  SELF: '자소용',
  SALE: '판매용',
  MERCHANDISE: '상품',
  OTHER: '기타',
};

export const PRODUCTION_LINE_BY_DISPO = {
  M01: '냉동밥',
  M02: '오니기리',
  M03: '냉동만두',
  M04: '튀김',
  M05: '핫도그',
  M06: '추출/농축',
  M07: 'HMI',
  M08: '소스',
  M09: '분말',
  M10: '냉장만두',
  M11: '건면봉지',
  M12: '유탕봉지',
  M13: '전처리',
  M14: '건면컵',
  M15: '유탕컵',
  M16: '요리면봉지',
  M17: '요리면컵',
  M19: '분말스프',
  M30: '즉석밥1라인',
  M31: 'FD',
  M32: '즉석밥2라인',
} as const;

export const PRODUCTION_LINE_OPTIONS = Object.entries(PRODUCTION_LINE_BY_DISPO).map(
  ([dispo, label]) => ({ dispo, label })
);

export function classifyInventoryStock(matnr: string, dispo?: string): InventoryStockType {
  const normalizedMatnr = String(matnr || '').trim();
  const normalizedDispo = String(dispo || '').trim().toUpperCase();

  if (normalizedMatnr.startsWith('6')) return 'MERCHANDISE';
  if (normalizedMatnr.startsWith('5') && normalizedDispo.startsWith('A')) return 'SELF';
  if (normalizedMatnr.startsWith('5') && normalizedDispo.startsWith('M')) return 'SALE';
  return 'OTHER';
}

export function getProductionLine(dispo?: string): string | null {
  const normalized = String(dispo || '').trim().toUpperCase();
  return PRODUCTION_LINE_BY_DISPO[normalized as keyof typeof PRODUCTION_LINE_BY_DISPO] || null;
}
