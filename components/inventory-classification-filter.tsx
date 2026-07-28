'use client';

import { Factory, SlidersHorizontal } from 'lucide-react';
import {
  INVENTORY_STOCK_TYPE_LABELS,
  InventoryStockTypeFilter,
  PRODUCTION_LINE_OPTIONS,
} from '@/lib/inventory-classification';

interface Props {
  stockType: InventoryStockTypeFilter;
  productionLine: string;
  onStockTypeChange: (value: InventoryStockTypeFilter) => void;
  onProductionLineChange: (value: string) => void;
}

const stockTypeOptions: Array<{ value: InventoryStockTypeFilter; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'SELF', label: INVENTORY_STOCK_TYPE_LABELS.SELF },
  { value: 'SALE', label: INVENTORY_STOCK_TYPE_LABELS.SALE },
  { value: 'MERCHANDISE', label: INVENTORY_STOCK_TYPE_LABELS.MERCHANDISE },
  { value: 'OTHER', label: INVENTORY_STOCK_TYPE_LABELS.OTHER },
];

export default function InventoryClassificationFilter({
  stockType,
  productionLine,
  onStockTypeChange,
  onProductionLineChange,
}: Props) {
  return (
    <div className="flex flex-col xl:flex-row xl:items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold text-neutral-700 shrink-0">
        <SlidersHorizontal size={15} className="text-blue-600" />
        재고 구분
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
        {stockTypeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onStockTypeChange(option.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
              stockType === option.value
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-neutral-200'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="flex min-w-0 items-center gap-2 text-xs font-bold text-neutral-700 xl:ml-auto">
        <Factory size={15} className="text-orange-600 shrink-0" />
        생산라인
        <select
          value={productionLine}
          onChange={(event) => onProductionLineChange(event.target.value)}
          className="min-w-[190px] rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          <option value="ALL">전체 생산라인</option>
          {PRODUCTION_LINE_OPTIONS.map(({ dispo, label }) => (
            <option key={dispo} value={dispo}>
              {dispo} · {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
