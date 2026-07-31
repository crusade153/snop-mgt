import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDashboardData } from '@/actions/dashboard-actions';
import { createAdminSupabaseClient } from '@/lib/admin-auth';
import { classifyInventoryStatus, isNoExpiry, type InventoryRiskStatus } from '@/lib/inventory-status';
import type { InventoryBatch, IntegratedItem } from '@/types/analysis';

const RISK_STATUSES: InventoryRiskStatus[] = ['disposed', 'imminent', 'critical'];
const STATUS_ORDER: InventoryRiskStatus[] = ['disposed', 'imminent', 'critical', 'healthy', 'no_expiry'];

type Bucket = { qty: number; value: number };
type SnapshotRecord = {
  snapshot_date: string; material_code: string; product_name: string; brand: string; category: string; family: string;
  production_line: string | null; stock_type: string | null; storage_scope: string; unit: string;
  quantity: number; unit_price: number; stock_value: number; min_remain_days: number | null; nearest_expiry: string | null;
  status: InventoryRiskStatus; price_source: string; risk_breakdown: Record<string, Bucket>; action_breakdown: Record<string, Bucket>;
};

function seoulDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

function remainingDays(expirationDate: string, referenceDate: string) {
  if (isNoExpiry(expirationDate)) return null;
  const text = String(expirationDate).replace(/[^0-9]/g, '');
  if (text.length !== 8) return null;
  return differenceInCalendarDays(parseISO(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`), parseISO(referenceDate));
}

function storageScope(batch: InventoryBatch) {
  if (batch.source === 'FBH') return 'FBH';
  const location = String(batch.location || '');
  return /외주|시너지|협력|3pl/i.test(location) ? '외주창고' : '플랜트';
}

function add(bucket: Record<string, Bucket>, key: string, qty: number, value: number) {
  const current = bucket[key] || { qty: 0, value: 0 };
  current.qty += qty;
  current.value += value;
  bucket[key] = current;
}

function worstStatus(breakdown: Record<string, Bucket>): InventoryRiskStatus {
  return STATUS_ORDER.find((status) => (breakdown[status]?.qty || 0) > 0) || 'no_expiry';
}

async function buildSnapshot(date: string): Promise<SnapshotRecord[]> {
  const data = await getDashboardData(date, date);
  if (!data?.success || !data.data?.integratedArray) throw new Error(data?.message || '재고 데이터를 불러오지 못했습니다.');

  return (data.data.integratedArray as IntegratedItem[]).map((item) => {
    const risk_breakdown: Record<string, Bucket> = {};
    const action_breakdown: Record<string, Bucket> = {};
    let quantity = 0, stock_value = 0, pricedQuantity = 0, minRemainDays: number | null = null, nearestExpiry: string | null = null;
    let stockType: string | null = null, productionLine: string | null = null, priceSource = 'CURRENT_MONTH';
    const scopes = new Set<string>();

    (item.inventory?.batches || []).forEach((batch) => {
      if (!batch || Number(batch.quantity) <= 0) return;
      const qty = Number(batch.quantity) || 0;
      const value = batch.priceSource === 'ENDING_INVENTORY' ? Number(batch.stockValue) || 0 : 0;
      const remain = remainingDays(batch.expirationDate, date);
      const status = classifyInventoryStatus(batch.expirationDate, remain ?? Number.POSITIVE_INFINITY);
      const scope = storageScope(batch);
      quantity += qty; stock_value += value; scopes.add(scope);
      if (batch.priceSource === 'ENDING_INVENTORY') { pricedQuantity += qty; priceSource = 'ENDING_INVENTORY'; }
      else if (priceSource !== 'ENDING_INVENTORY' && batch.priceSource === 'UNKNOWN') priceSource = 'UNKNOWN';
      stockType ||= batch.stockType || null;
      productionLine ||= batch.productionLine || null;
      if (remain !== null && (minRemainDays === null || remain < minRemainDays)) {
        minRemainDays = remain;
        nearestExpiry = String(batch.expirationDate).replace(/[^0-9]/g, '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      }
      add(risk_breakdown, status, qty, value);
      add(action_breakdown, `${batch.stockType || 'OTHER'}|${scope}|${status}`, qty, value);
    });

    return {
      snapshot_date: date, material_code: item.code, product_name: item.name, brand: item.brand, category: item.category, family: item.family,
      production_line: productionLine, stock_type: stockType, storage_scope: scopes.size === 1 ? [...scopes][0] : scopes.size ? '혼합' : '플랜트',
      unit: item.unit || 'EA', quantity, unit_price: pricedQuantity > 0 ? stock_value / pricedQuantity : 0, stock_value,
      min_remain_days: minRemainDays, nearest_expiry: nearestExpiry, status: worstStatus(risk_breakdown), price_source: priceSource,
      risk_breakdown, action_breakdown,
    };
  }).filter((row) => row.quantity > 0);
}

export async function captureInventoryDailySnapshot(snapshotDate = seoulDate()) {
  const rows = await buildSnapshot(snapshotDate);
  const supabase = createAdminSupabaseClient();
  // 같은 날짜를 다시 실행해도 그 시점의 재고만 남도록 기존 스냅샷을 교체한다.
  const { error: deleteError } = await supabase.from('snop_inventory_daily_snapshots').delete().eq('snapshot_date', snapshotDate);
  if (deleteError) throw new Error(`기존 재고 스냅샷 정리 실패: ${deleteError.message}`);
  const { error } = await supabase.from('snop_inventory_daily_snapshots').upsert(rows, { onConflict: 'snapshot_date,material_code' });
  if (error) throw new Error(`재고 스냅샷 저장 실패: ${error.message}`);
  return { snapshotDate, itemCount: rows.length };
}

type StoredSnapshot = SnapshotRecord;
function riskOf(row: StoredSnapshot, status: InventoryRiskStatus) { return row.risk_breakdown?.[status] || { qty: 0, value: 0 }; }

async function loadSnapshotRows(supabase: SupabaseClient, snapshotDate: string): Promise<StoredSnapshot[]> {
  const rows: StoredSnapshot[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('snop_inventory_daily_snapshots').select('*')
      .eq('snapshot_date', snapshotDate).order('material_code').range(from, from + pageSize - 1);
    if (error) throw new Error(`스냅샷 조회 실패: ${error.message}`);
    rows.push(...((data || []) as StoredSnapshot[]));
    if ((data || []).length < pageSize) return rows;
  }
}

export async function getInventoryMorningBriefing() {
  const supabase = createAdminSupabaseClient();
  const { data: latest, error: latestError } = await supabase.from('snop_inventory_daily_snapshots')
    .select('*').order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw new Error(`최신 스냅샷 조회 실패: ${latestError.message}`);
  if (!latest) throw new Error('아직 재고 스냅샷이 없습니다. 최초 일별 스냅샷 적재 후 브리핑을 사용할 수 있습니다.');
  const date = latest.snapshot_date as string;
  const current = await loadSnapshotRows(supabase, date);
  const { data: previous } = await supabase.from('snop_inventory_daily_snapshots').select('*').lt('snapshot_date', date)
    .order('snapshot_date', { ascending: false }).limit(1);
  const previousDate = previous?.[0]?.snapshot_date as string | undefined;
  const priorRows = previousDate ? await loadSnapshotRows(supabase, previousDate) : [];
  const priorByCode = new Map(priorRows.map((row) => [row.material_code, row]));
  const rows = current;

  const buckets = RISK_STATUSES.map((status) => {
    const matching = rows.filter((row) => riskOf(row, status).qty > 0);
    const priorMatching = priorRows.filter((row) => riskOf(row, status).qty > 0);
    const value = matching.reduce((sum, row) => sum + riskOf(row, status).value, 0);
    const priorValue = priorMatching.reduce((sum, row) => sum + riskOf(row, status).value, 0);
    return { status, quantity: Math.round(matching.reduce((sum, row) => sum + riskOf(row, status).qty, 0)), value: Math.round(value), itemCount: matching.length,
      valueChange: previousDate ? Math.round(value - priorValue) : null, itemCountChange: previousDate ? matching.length - priorMatching.length : null };
  });
  const currentRisk = rows.filter((row) => riskOf(row, 'disposed').qty > 0 || riskOf(row, 'imminent').qty > 0);
  const newEntries = currentRisk.filter((row) => { const prior = priorByCode.get(row.material_code); return !prior || (riskOf(prior, 'disposed').qty <= 0 && riskOf(prior, 'imminent').qty <= 0); });
  const movedToDisposed = rows.filter((row) => { const prior = priorByCode.get(row.material_code); return riskOf(row, 'disposed').qty > 0 && !!prior && riskOf(prior, 'imminent').qty > 0; });
  const topItems = [...currentRisk].sort((a, b) => (riskOf(b, 'disposed').value + riskOf(b, 'imminent').value) - (riskOf(a, 'disposed').value + riskOf(a, 'imminent').value)).slice(0, 5)
    .map((row) => ({ materialCode: row.material_code, name: row.product_name, value: Math.round(riskOf(row, 'disposed').value + riskOf(row, 'imminent').value), status: riskOf(row, 'disposed').qty > 0 ? '폐기' : '임박' }));
  const topValue = topItems.reduce((sum, row) => sum + row.value, 0);
  const totalImminentValue = currentRisk.reduce((sum, row) => sum + riskOf(row, 'disposed').value + riskOf(row, 'imminent').value, 0);
  const groups = new Map<string, Bucket>();
  currentRisk.forEach((row) => Object.entries(row.action_breakdown || {}).forEach(([key, bucket]) => {
    const [, , status] = key.split('|');
    if (status !== 'disposed' && status !== 'imminent') return;
    const groupKey = key.split('|').slice(0, 2).join('|');
    const current = groups.get(groupKey) || { qty: 0, value: 0 };
    current.qty += Number(bucket.qty) || 0;
    current.value += Number(bucket.value) || 0;
    groups.set(groupKey, current);
  }));
  const actionGroups = [...groups.entries()].map(([key, bucket]) => ({ group: key, quantity: Math.round(bucket.qty), value: Math.round(bucket.value) })).sort((a, b) => b.value - a.value).slice(0, 4);
  const unpricedItemCount = rows.filter((row) => row.price_source !== 'ENDING_INVENTORY').length;

  return { snapshotDate: date, comparedTo: previousDate || null, buckets, newEntryCount: previousDate ? newEntries.length : null, movedToDisposedCount: previousDate ? movedToDisposed.length : null,
    top5Concentration: totalImminentValue > 0 ? Math.round((topValue / totalImminentValue) * 1000) / 10 : 0, topItems, actionGroups, unpricedItemCount };
}
