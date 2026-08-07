'use client';

/**
 * 제품 상세의 "이 제품이 쓰는 자재" 섹션 (정전개)
 *
 * /materials 는 자재 → 완제품(역전개), 여기는 완제품 → 자재(정전개)다.
 * 양방향이 이어져야 완제품에서 자재까지 한 번에 넘어갈 수 있다.
 *
 * 제품 상세 첫 화면을 무겁게 하지 않으려고 펼칠 때 불러온다.
 */

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, Link2 } from 'lucide-react';
import { getProductMaterials, type ForwardBomEntry } from '@/actions/material-insight-actions';
import { FILTERABLE_MATERIAL_CLASSES, MATERIAL_CLASS_LABEL } from '@/lib/bom/explosion-sql';

const PLANT_NAME: Record<string, string> = {
  '1021': '1공장',
  '1022': '3공장',
  '1023': '2공장',
  '1031': '온라인물류',
};

const qty = (value: number) =>
  value >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(value < 10 ? 2 : 0);

export default function ProductMaterialsSection({ matnr }: { matnr: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ForwardBomEntry[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || entries !== null || loading) return;

    setLoading(true);
    getProductMaterials(matnr)
      .then((result) => {
        setEntries(result.entries);
        if (!result.success) setMessage(result.message ?? '자재 정보를 불러오지 못했습니다.');
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  };

  // 이 제품을 가장 먼저 못 만들게 할 자재 = 생산가능수량 최솟값.
  // 병목은 자재 구분과 무관하게 전체 기준으로 본다 — 원재료가 병목이면 그게 답이다.
  const bottleneck = entries?.find((entry) => entry.buildable !== null) ?? null;
  const visible = classFilter
    ? (entries ?? []).filter((entry) => entry.materialClass === classFilter)
    : entries ?? [];

  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Link2 size={18} className="text-neutral-500" />
          <span className="font-bold text-neutral-900">이 제품이 쓰는 자재</span>
          {entries ? (
            <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
              {entries.length}종
            </span>
          ) : null}
        </div>
        <ChevronDown
          size={18}
          className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="border-t border-neutral-200 px-5 py-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-neutral-500">불러오는 중…</div>
          ) : message ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {message}
            </div>
          ) : !entries?.length ? (
            <div className="py-8 text-center text-sm text-neutral-500">
              BOM에 등록된 포장재가 없습니다. (상품·외주 제품이거나 BOM 미등록)
            </div>
          ) : (
            <>
              {bottleneck ? (
                <div className="mb-3 rounded border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm leading-6 text-sky-900">
                  현재 자재 재고로는 <strong>{bottleneck.buildable?.toLocaleString()}개</strong>까지
                  만들 수 있습니다. 가장 먼저 걸리는 자재는{' '}
                  <strong>{bottleneck.materialName || bottleneck.materialCode}</strong>입니다.
                  <span className="ml-1 text-xs text-sky-700">
                    (해당 자재를 이 제품에만 전량 투입할 때 기준)
                  </span>
                </div>
              ) : null}

              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setClassFilter(null)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                    classFilter === null
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }`}
                >
                  전체 {entries.length}
                </button>
                {FILTERABLE_MATERIAL_CLASSES.map((code) => {
                  const count = entries.filter((entry) => entry.materialClass === code).length;
                  if (!count) return null;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setClassFilter(classFilter === code ? null : code)}
                      className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                        classFilter === code
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {MATERIAL_CLASS_LABEL[code]} {count}
                    </button>
                  );
                })}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-xs text-neutral-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">자재</th>
                      <th className="px-3 py-2 text-left font-semibold">구분</th>
                      <th className="px-3 py-2 text-left font-semibold">공장</th>
                      <th className="px-3 py-2 text-right font-semibold">개당 소요</th>
                      <th className="px-3 py-2 text-right font-semibold">재고</th>
                      <th className="px-3 py-2 text-right font-semibold">생산가능</th>
                      <th className="px-3 py-2 text-left font-semibold">공용</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {visible.map((entry) => (
                      <tr key={`${entry.werks}|${entry.materialCode}`} className="text-neutral-800">
                        <td className="px-3 py-2">
                          <Link
                            href={`/materials?search=${entry.materialCode}`}
                            className="font-medium text-[#1565C0] hover:underline"
                          >
                            {entry.materialName || entry.materialCode}
                          </Link>
                          <div className="text-xs text-neutral-500">{entry.materialCode}</div>
                          {entry.minLevel > 1 ? (
                            <div className="mt-0.5 text-[11px] text-neutral-500">
                              경유: {entry.viaPaths.join(' / ')}
                            </div>
                          ) : null}
                          {entry.warning ? (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-700">
                              <AlertTriangle className="h-3 w-3" /> {entry.warning}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-600">
                          {MATERIAL_CLASS_LABEL[entry.materialClass] ?? entry.materialClass}
                        </td>
                        <td className="px-3 py-2 text-neutral-600">
                          {PLANT_NAME[entry.werks] ?? entry.werks}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {entry.qtyPerFg < 0.01
                            ? entry.qtyPerFg.toExponential(1)
                            : entry.qtyPerFg.toFixed(3)}
                          <span className="ml-1 text-xs text-neutral-400">{entry.bomUom}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {qty(entry.onHand)}
                          <span className="ml-1 text-xs text-neutral-400">{entry.unit}</span>
                          {entry.openPoQty > 0 ? (
                            <div className="text-[11px] text-neutral-500">
                              발주중 {qty(entry.openPoQty)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {entry.buildable === null ? (
                            <span className="text-neutral-300">—</span>
                          ) : (
                            `${entry.buildable.toLocaleString()}개`
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {entry.sharedWithCount > 0 ? (
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                              다른 제품 {entry.sharedWithCount}개와 공용
                            </span>
                          ) : (
                            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                              이 제품 전용
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
