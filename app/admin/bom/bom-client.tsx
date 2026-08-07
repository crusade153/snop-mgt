"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Network, RefreshCw, XCircle } from "lucide-react";
import type { BomBuildRun } from "@/types/material";
import { triggerBomRebuild } from "./actions";

type Props = {
  history: BomBuildRun[];
  configError?: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StatusBadge({ status }: { status: BomBuildRun["status"] }) {
  if (status === "SUCCESS") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> 성공
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
        <XCircle className="h-3 w-3" /> 실패
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
      진행중
    </span>
  );
}

export default function BomAdminClient({ history, configError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const latest = history[0];

  const handleRebuild = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await triggerBomRebuild("RAW_AND_PACKAGING");
      setFailed(!result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-neutral-500">
            <Network className="h-4 w-4" /> BOM 마트
          </div>
          <h1 className="mt-1 text-2xl font-bold text-neutral-950">자재 역전개 데이터 재빌드</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
            SAP BOM(PP_STPO)을 다단계 전개해 &ldquo;완제품 1개당 자재 소요량&rdquo;을 만들어 둡니다.
            대상은 <strong>원재료·부재료·포장재</strong>(자재코드 1·2·3으로 시작)이며, 반제품을 거쳐
            들어가는 자재까지 역산합니다. 자재 화면의 역전개와 생산가능수량이 이 데이터를 씁니다.
            BOM은 거의 바뀌지 않으므로 자동 실행 없이 필요할 때만 눌러 갱신합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRebuild}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "재빌드 중… (1~2분)" : "지금 재빌드"}
        </button>
      </header>

      {configError ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {configError}
        </div>
      ) : null}

      {message ? (
        <div
          className={`rounded border p-4 text-sm leading-6 ${
            failed
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message}
        </div>
      ) : null}

      {latest?.status === "SUCCESS" && latest.suspectLotBasisCount ? (
        <div className="flex gap-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">기준수량(BMENG) 오등록 {latest.suspectLotBasisCount}건</div>
            <p className="mt-1">
              BOM 기준수량이 1로 등록됐지만 실제 자재 소요는 로트(수천 개) 기준인 품목입니다.
              그대로 쓰면 소요량이 로트 배수만큼 부풀려지므로 계산에서 제외하고 자재 화면에
              &ldquo;검토 필요&rdquo;로 표시합니다. SAP 마스터 정정이 필요합니다.
            </p>
          </div>
        </div>
      ) : null}

      <section className="rounded border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3 text-sm font-bold text-neutral-900">
          빌드 이력
        </div>
        {history.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-neutral-500">
            아직 빌드 이력이 없습니다. 위 버튼으로 최초 적재를 실행해주세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">실행 시각</th>
                  <th className="px-4 py-2 text-left font-semibold">상태</th>
                  <th className="px-4 py-2 text-right font-semibold">행수</th>
                  <th className="px-4 py-2 text-right font-semibold">완제품</th>
                  <th className="px-4 py-2 text-right font-semibold">자재</th>
                  <th className="px-4 py-2 text-right font-semibold">조회(초)</th>
                  <th className="px-4 py-2 text-right font-semibold">검토 필요</th>
                  <th className="px-4 py-2 text-left font-semibold">실행자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {history.map((run) => (
                  <tr key={run.buildId} className="text-neutral-800">
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={run.status} />
                      {run.errorMessage ? (
                        <div className="mt-1 max-w-xs text-xs text-red-600">{run.errorMessage}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {run.rowCount?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {run.rootCount?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {run.materialCount?.toLocaleString() ?? "-"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {run.bqMs === null ? "-" : (run.bqMs / 1000).toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {(run.suspectLotBasisCount ?? 0) + (run.uomMismatchCount ?? 0) || "-"}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{run.triggeredByName ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
