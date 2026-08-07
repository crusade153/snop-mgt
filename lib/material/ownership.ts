/**
 * 담당자 매핑·임계값 저장소 접근
 *
 * Server Action 파일('use server')은 async 함수만 export 할 수 있어서
 * 조회 로직은 여기 lib 에 둔다.
 */

import { unstable_cache } from 'next/cache';
import bigqueryClient from '@/lib/bigquery';
import { createAdminSupabaseClient } from '@/lib/admin-auth';
import { DEFAULT_THRESHOLDS, type AllocationThresholds } from '@/lib/material/allocation';
import type { OwnerScopeType, ProductOwner } from '@/types/material';

const OWNERS_TABLE = 'snop_product_owners';
const THRESHOLDS_TABLE = 'snop_material_thresholds';

export async function loadProductOwners(): Promise<ProductOwner[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from(OWNERS_TABLE)
    .select('*')
    .order('scope_type')
    .order('scope_key');
  if (error) throw new Error(`담당자 매핑 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    scopeType: String(row.scope_type) as OwnerScopeType,
    scopeKey: String(row.scope_key ?? ''),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name ?? ''),
    ownerTeam: row.owner_team ? String(row.owner_team) : null,
    role: String(row.role ?? 'PRIMARY') as ProductOwner['role'],
  }));
}

export async function loadThresholds(): Promise<AllocationThresholds> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from(THRESHOLDS_TABLE).select('key, value');
  // 임계값 테이블이 비어 있어도 화면은 떠야 한다. 기본값으로 돌아간다.
  if (error) return { ...DEFAULT_THRESHOLDS };

  const map = new Map((data ?? []).map((row) => [String(row.key), Number(row.value)]));
  const pick = (key: string, fallback: number) => {
    const value = map.get(key);
    return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
  };

  return {
    usageLookbackMonths: pick('usage_lookback_months', DEFAULT_THRESHOLDS.usageLookbackMonths),
    excessMonths: pick('excess_months', DEFAULT_THRESHOLDS.excessMonths),
    severeMonths: pick('severe_months', DEFAULT_THRESHOLDS.severeMonths),
    suspectQtyPerFg: pick('suspect_qty_per_fg', DEFAULT_THRESHOLDS.suspectQtyPerFg),
  };
}

export interface HierarchyNode {
  scopeType: OwnerScopeType;
  key: string;
  /** 이 계층에 속한 살아있는 완제품 수. 매핑 우선순위를 정할 때 참고한다. */
  productCount: number;
  /** 상위 계층 이름. 제품군이 어느 브랜드 밑인지 보여주기 위한 것. */
  parentBrand?: string;
  parentCategory?: string;
}

/**
 * 담당자를 붙일 수 있는 제품계층 목록.
 * BOM 마트가 아니라 자재마스터에서 뽑는다 — BOM 이 없는 완제품(상품·외주, 실측 719개)도
 * 담당자는 있어야 하기 때문이다.
 */
async function fetchHierarchyUncached(): Promise<HierarchyNode[]> {
  const query = `
    WITH live AS (
      SELECT
        IFNULL(PRDHA_1_T, '') AS BRAND,
        IFNULL(PRDHA_2_T, '') AS CATEGORY,
        IFNULL(PRDHA_3_T, '') AS FAMILY,
        MATNR
      FROM \`harimfood-361004.harim_sap_bi.SD_MARA\`
      WHERE MTART = 'FERT'
        AND MATNR BETWEEN '50000000' AND '69999999'
        AND IFNULL(MATNR_T, '') NOT LIKE '%미사용%'
    )
    SELECT 'BRAND' AS SCOPE_TYPE, BRAND AS KEY, '' AS PARENT_BRAND, '' AS PARENT_CATEGORY,
           COUNT(DISTINCT MATNR) AS PRODUCTS
    FROM live WHERE BRAND != '' GROUP BY 1, 2, 3, 4
    UNION ALL
    SELECT 'CATEGORY', CATEGORY, ANY_VALUE(BRAND), '', COUNT(DISTINCT MATNR)
    FROM live WHERE CATEGORY != '' GROUP BY 1, 2
    UNION ALL
    SELECT 'FAMILY', FAMILY, ANY_VALUE(BRAND), ANY_VALUE(CATEGORY), COUNT(DISTINCT MATNR)
    FROM live WHERE FAMILY != '' GROUP BY 1, 2
    ORDER BY SCOPE_TYPE, PRODUCTS DESC
  `;

  const [rows] = await bigqueryClient.query({ query });
  return (rows as Record<string, unknown>[]).map((row) => ({
    scopeType: String(row.SCOPE_TYPE) as OwnerScopeType,
    key: String(row.KEY ?? ''),
    productCount: Number(row.PRODUCTS ?? 0),
    parentBrand: String(row.PARENT_BRAND ?? '') || undefined,
    parentCategory: String(row.PARENT_CATEGORY ?? '') || undefined,
  }));
}

export function loadProductHierarchy(): Promise<HierarchyNode[]> {
  return unstable_cache(fetchHierarchyUncached, ['product-hierarchy-v1'], {
    revalidate: 3600,
    tags: ['report-data'],
  })();
}
