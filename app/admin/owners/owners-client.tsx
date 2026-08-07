"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserCog } from "lucide-react";
import type { HierarchyNode } from "@/lib/material/ownership";
import type { OwnerScopeType, ProductOwner } from "@/types/material";
import { deleteProductOwner, saveProductOwner } from "./actions";
import type { ProfileOption } from "./page";

type Props = {
  owners: ProductOwner[];
  hierarchy: HierarchyNode[];
  profiles: ProfileOption[];
  configError?: string;
};

const SCOPE_LABEL: Record<OwnerScopeType, string> = {
  BRAND: "브랜드",
  CATEGORY: "카테고리",
  FAMILY: "제품군",
};

/** 가장 구체적인 매핑이 이긴다. 화면에서도 같은 순서로 보여준다. */
const SCOPE_ORDER: OwnerScopeType[] = ["FAMILY", "CATEGORY", "BRAND"];

export default function OwnersAdminClient({ owners, hierarchy, profiles, configError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [scopeType, setScopeType] = useState<OwnerScopeType>("FAMILY");
  const [scopeKey, setScopeKey] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [role, setRole] = useState<"PRIMARY" | "BACKUP">("PRIMARY");

  const scopeOptions = useMemo(
    () => hierarchy.filter((node) => node.scopeType === scopeType),
    [hierarchy, scopeType],
  );

  const assignedKeys = useMemo(
    () => new Set(owners.filter((o) => o.role === "PRIMARY").map((o) => `${o.scopeType}|${o.scopeKey}`)),
    [owners],
  );

  // 아직 주인이 없는 계층. 이걸 0으로 만드는 게 이 화면의 목적이다.
  const unassigned = useMemo(
    () =>
      hierarchy
        .filter((node) => node.scopeType === "FAMILY" && !assignedKeys.has(`FAMILY|${node.key}`))
        .sort((a, b) => b.productCount - a.productCount),
    [hierarchy, assignedKeys],
  );

  const grouped = useMemo(
    () =>
      SCOPE_ORDER.map((type) => ({
        type,
        rows: owners
          .filter((owner) => owner.scopeType === type)
          .sort((a, b) => a.scopeKey.localeCompare(b.scopeKey)),
      })).filter((group) => group.rows.length > 0),
    [owners],
  );

  const handleSave = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveProductOwner({ scopeType, scopeKey, ownerId, role });
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) {
        setScopeKey("");
        router.refresh();
      }
    });
  };

  const handleDelete = (id: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteProductOwner(id);
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-bold text-neutral-500">
          <UserCog className="h-4 w-4" /> 자재 담당자
        </div>
        <h1 className="mt-1 text-2xl font-bold text-neutral-950">제품계층 담당자 지정</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
          여기서 지정한 담당자에게 그 제품이 쓰는 원부포장재의 재고·발주 금액이 귀속됩니다.
          한 자재를 여러 담당자가 쓰면 최근 생산실적 비중으로 나눠 배분합니다.
          매핑은 <strong>제품군 &gt; 카테고리 &gt; 브랜드</strong> 순으로 가장 구체적인 것이 적용되고,
          어디에도 걸리지 않은 제품은 &lsquo;담당 미지정&rsquo;으로 모입니다.
        </p>
      </header>

      {configError ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {configError}
        </div>
      ) : null}

      {message ? (
        <div
          className={`rounded border p-4 text-sm leading-6 ${
            failed ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message}
        </div>
      ) : null}

      <section className="rounded border border-neutral-200 bg-white p-4">
        <div className="text-sm font-bold text-neutral-900">담당자 추가</div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="block">
            <span className="text-xs font-semibold text-neutral-500">계층</span>
            <select
              value={scopeType}
              onChange={(event) => {
                setScopeType(event.target.value as OwnerScopeType);
                setScopeKey("");
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              {SCOPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {SCOPE_LABEL[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-neutral-500">담당 범위</span>
            <select
              value={scopeKey}
              onChange={(event) => setScopeKey(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">선택하세요</option>
              {scopeOptions.map((node) => (
                <option key={node.key} value={node.key}>
                  {node.key} ({node.productCount}개 품목)
                  {assignedKeys.has(`${node.scopeType}|${node.key}`) ? " · 주담당 있음" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-neutral-500">담당 구분</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as "PRIMARY" | "BACKUP")}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="PRIMARY">주담당</option>
              <option value="BACKUP">백업</option>
            </select>
          </label>

          <label className="block md:col-span-3">
            <span className="text-xs font-semibold text-neutral-500">담당자</span>
            <select
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">선택하세요</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.team ? ` · ${profile.team}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !scopeKey || !ownerId}
              className="inline-flex w-full items-center justify-center gap-2 rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> 추가
            </button>
          </div>
        </div>
      </section>

      {unassigned.length > 0 ? (
        <section className="rounded border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-bold text-amber-900">
            아직 주인이 없는 제품군 {unassigned.length}개
          </div>
          <p className="mt-1 text-sm leading-6 text-amber-800">
            이 제품군들이 쓰는 자재는 &lsquo;담당 미지정&rsquo;으로 잡힙니다. 상위 브랜드에 담당자를 지정하면
            제품군을 하나씩 채우지 않아도 함께 커버됩니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {unassigned.slice(0, 30).map((node) => (
              <button
                key={node.key}
                type="button"
                onClick={() => {
                  setScopeType("FAMILY");
                  setScopeKey(node.key);
                }}
                className="rounded bg-white px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
              >
                {node.key} <span className="text-amber-600">({node.productCount})</span>
              </button>
            ))}
            {unassigned.length > 30 ? (
              <span className="px-2 py-1 text-xs text-amber-700">외 {unassigned.length - 30}개</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {grouped.map((group) => (
        <section key={group.type} className="rounded border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900">
            {SCOPE_LABEL[group.type]} 단위 담당 ({group.rows.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">범위</th>
                  <th className="px-4 py-2 text-left font-semibold">담당자</th>
                  <th className="px-4 py-2 text-left font-semibold">팀</th>
                  <th className="px-4 py-2 text-left font-semibold">구분</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {group.rows.map((owner) => (
                  <tr key={owner.id} className="text-neutral-800">
                    <td className="px-4 py-2 font-medium">{owner.scopeKey}</td>
                    <td className="px-4 py-2">{owner.ownerName}</td>
                    <td className="px-4 py-2 text-neutral-600">{owner.ownerTeam ?? "-"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          owner.role === "PRIMARY"
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {owner.role === "PRIMARY" ? "주담당" : "백업"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(owner.id)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> 해제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
