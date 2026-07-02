"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  Clock3,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { updateUserPassword, updateUserStatus } from "./actions";

export type ManagedUser = {
  id: string;
  email: string;
  name: string;
  status: string;
  role: string;
  isAdmin: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
};

type Props = {
  users: ManagedUser[];
  configError?: string;
};

const statusLabels: Record<string, string> = {
  active: "승인",
  pending: "대기",
  suspended: "중지",
  rejected: "반려",
};

const statusClasses: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  suspended: "bg-neutral-100 text-neutral-700 border-neutral-300",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function UserManagementClient({ users, configError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  const counts = useMemo(() => {
    return users.reduce(
      (acc, user) => {
        acc.total += 1;
        if (user.status === "active") acc.active += 1;
        else if (user.status === "pending") acc.pending += 1;
        else acc.blocked += 1;
        return acc;
      },
      { total: 0, active: 0, pending: 0, blocked: 0 },
    );
  }, [users]);

  const runStatusChange = (userId: string, status: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateUserStatus(userId, status);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  const runPasswordChange = (userId: string) => {
    const password = passwords[userId] ?? "";
    setMessage(null);
    startTransition(async () => {
      const result = await updateUserPassword(userId, password);
      setMessage(result.message);
      if (result.ok) {
        setPasswords((current) => ({ ...current, [userId]: "" }));
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-red-600">
            <ShieldCheck size={18} />
            Admin
          </div>
          <h1 className="mt-2 text-2xl font-bold text-neutral-950">회원관리</h1>
          <p className="mt-1 text-sm text-neutral-500">
            가입 승인, 계정 중지, 비밀번호 변경을 한 화면에서 처리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
        >
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      {configError && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {configError}
        </div>
      )}

      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-700">
          {message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryItem label="전체 회원" value={counts.total} />
        <SummaryItem label="승인 완료" value={counts.active} />
        <SummaryItem label="승인 대기" value={counts.pending} />
      </div>

      <div className="overflow-hidden rounded border border-neutral-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs font-bold uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">가입일</th>
                <th className="px-4 py-3">최근 로그인</th>
                <th className="px-4 py-3">승인 관리</th>
                <th className="px-4 py-3">비밀번호 변경</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {users.map((user) => (
                <tr key={user.id} className="align-top hover:bg-neutral-50/70">
                  <td className="px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded bg-neutral-100 text-neutral-600">
                        <UserRound size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-neutral-950">{user.name}</div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                          <Mail size={13} />
                          {user.email}
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-400">{user.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-bold ${
                          statusClasses[user.status] ?? statusClasses.pending
                        }`}
                      >
                        {user.status === "active" ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                        {statusLabels[user.status] ?? user.status}
                      </span>
                      {user.isAdmin && (
                        <div className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                          <ShieldCheck size={13} />
                          관리자
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-neutral-600">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-4 text-neutral-600">{formatDate(user.lastSignInAt)}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isPending || user.status === "active"}
                        onClick={() => runStatusChange(user.id, "active")}
                        className="inline-flex h-9 items-center gap-1.5 rounded bg-emerald-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        <CheckCircle2 size={14} />
                        승인
                      </button>
                      <button
                        type="button"
                        disabled={isPending || user.status === "suspended"}
                        onClick={() => runStatusChange(user.id, "suspended")}
                        className="inline-flex h-9 items-center gap-1.5 rounded bg-neutral-800 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        <Ban size={14} />
                        중지
                      </button>
                      <button
                        type="button"
                        disabled={isPending || user.status === "pending"}
                        onClick={() => runStatusChange(user.id, "pending")}
                        className="inline-flex h-9 items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-300"
                      >
                        대기로 변경
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex max-w-[320px] gap-2">
                      <input
                        type="password"
                        minLength={8}
                        value={passwords[user.id] ?? ""}
                        onChange={(event) =>
                          setPasswords((current) => ({
                            ...current,
                            [user.id]: event.target.value,
                          }))
                        }
                        placeholder="새 비밀번호 8자 이상"
                        className="h-9 min-w-0 flex-1 rounded border border-neutral-300 px-3 text-xs outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      />
                      <button
                        type="button"
                        disabled={isPending || (passwords[user.id] ?? "").length < 8}
                        onClick={() => runPasswordChange(user.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded bg-red-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        <KeyRound size={14} />
                        변경
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-neutral-500">
                    표시할 회원이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <div className="text-sm font-medium text-neutral-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-neutral-950">{value.toLocaleString("ko-KR")}</div>
    </div>
  );
}
