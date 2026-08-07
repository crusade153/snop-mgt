/**
 * BOM 리프 행 변환 — 순수 함수만 둔다.
 *
 * mart.ts 는 Supabase 클라이언트(→ next/headers)를 끌어오기 때문에 Next 런타임
 * 밖에서는 로드되지 않는다. 이 저장소에는 테스트 프레임워크가 없어서 검증 수단이
 * scripts/*.mjs 뿐인데, 변환 로직이 mart.ts 안에 있으면 그 검증을 할 수 없다.
 * 그래서 I/O 가 없는 부분만 여기로 분리한다.
 */

import type { BomLeafRow } from '@/types/material';

export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  // BigQuery 가 큰 정수를 { value: '123' } 래퍼로 주는 경우가 있다.
  const raw =
    typeof value === 'object' && value !== null && 'value' in value
      ? (value as { value: unknown }).value
      : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** BigQuery 전개 결과 → Supabase 적재 행 */
export function toLeafRecord(row: Record<string, unknown>, buildId: string) {
  return {
    root_matnr: text(row.root_matnr),
    material_code: text(row.material_code),
    werks: text(row.werks),
    root_name: text(row.root_name),
    root_brand: text(row.root_brand),
    root_category: text(row.root_category),
    root_family: text(row.root_family),
    root_uom: text(row.root_uom, 'EA'),
    material_name: text(row.material_name),
    material_class: text(row.material_class).slice(0, 1) || null,
    bom_uom: text(row.bom_uom),
    base_uom: text(row.base_uom),
    uom_mismatch: Boolean(row.uom_mismatch),
    qty_per_fg: num(row.qty_per_fg),
    has_fixed_qty: Boolean(row.has_fixed_qty),
    has_bad_qty: Boolean(row.has_bad_qty),
    suspect_lot_basis: Boolean(row.suspect_lot_basis),
    stlal_count: num(row.stlal_count, 1),
    min_level: num(row.min_level, 1),
    max_level: num(row.max_level, 1),
    path_count: num(row.path_count, 1),
    hit_depth_cap: Boolean(row.hit_depth_cap),
    via_paths: Array.isArray(row.via_paths) ? row.via_paths.map((value) => text(value)) : [],
    build_id: buildId,
  };
}

/** 저장 행(또는 BigQuery 결과) → 앱 도메인 타입. 컬럼명이 같아 양쪽 다 받는다. */
export function toBomLeafRow(record: Record<string, unknown>): BomLeafRow {
  return {
    rootMatnr: text(record.root_matnr),
    rootName: text(record.root_name),
    rootBrand: text(record.root_brand),
    rootCategory: text(record.root_category),
    rootFamily: text(record.root_family),
    rootUom: text(record.root_uom, 'EA'),
    werks: text(record.werks),
    materialCode: text(record.material_code),
    materialName: text(record.material_name),
    materialClass: text(record.material_class),
    bomUom: text(record.bom_uom),
    baseUom: text(record.base_uom),
    uomMismatch: Boolean(record.uom_mismatch),
    qtyPerFg: num(record.qty_per_fg),
    hasFixedQty: Boolean(record.has_fixed_qty),
    hasBadQty: Boolean(record.has_bad_qty),
    suspectLotBasis: Boolean(record.suspect_lot_basis),
    stlalCount: num(record.stlal_count, 1),
    minLevel: num(record.min_level, 1),
    maxLevel: num(record.max_level, 1),
    pathCount: num(record.path_count, 1),
    hitDepthCap: Boolean(record.hit_depth_cap),
    viaPaths: Array.isArray(record.via_paths)
      ? (record.via_paths as unknown[]).map((value) => text(value))
      : [],
  };
}
