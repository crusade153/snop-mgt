"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  Clock3,
  KeyRound,
  Lock,
  LockOpen,
  Mail,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import {
  createUserAccount,
  deleteUserAccount,
  resetUserPin,
  unlockUser,
  updateUserRole,
  updateUserStatus,
} from "./actions";

export type ManagedUser = {
  id: string;
  loginId: string;
  name: string;
  team: string;
  email: string;
  status: string;
  role: string;
  isAdmin: boolean;
  lockedUntil: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
};

type Props = {
  users: ManagedUser[];
  configError?: string;
  currentUserId: string;
};

type TabKey = "pending" | "active" | "roles";

const tabs: { key: TabKey; label: string; icon: typeof Clock3 }[] = [
  { key: "pending", label: "승인 대기", icon: Clock3 },
  // 중지·반려된 회원도 여기서 보여야 다시 살릴 수 있다.
  { key: "active", label: "가입 회원", icon: CheckCircle2 },
  { key: "roles", label: "역할 관리", icon: ShieldCheck },
];

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

const emptyDraft = {
  fullName: "",
  team: "",
  companyEmail: "",
  loginId: "",
  pin: "",
  role: "user" as "user" | "admin",
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

function isLocked(user: ManagedUser) {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
}

export default function UserManagementClient({ users, configError, currentUserId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("pending");
  const [pins, setPins] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const counts = useMemo(
    () =>
      users.reduce(
        (acc, user) => {
          acc.total += 1;
          if (user.status === "active") acc.active += 1;
          else if (user.status === "pending") acc.pending += 1;
          else acc.blocked += 1;
          if (user.isAdmin) acc.admins += 1;
          return acc;
        },
        { total: 0, active: 0, pending: 0, blocked: 0, admins: 0 },
      ),
    [users],
  );

  const visibleUsers = useMemo(() => {
    if (tab === "pending") return users.filter((user) => user.status === "pending");
    if (tab === "active") return users.filter((user) => user.status !== "pending");
    return users;
  }, [users, tab]);

  const run = (action: () => Promise<{ ok: boolean; message: string }>, onOk?: () => void) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await action();
        setMessage(result.message);
        if (result.ok) {
          onOk?.();
          router.refresh();
        }
      } catch (error) {
        // 서버 액션이 예외를 던지면 아무 반응이 없어 '버튼이 안 먹는' 것처럼 보인다.
        setMessage(
          error instanceof Error
            ? `처리 중 오류가 발생했습니다: ${error.message}`
            : "처리 중 알 수 없는 오류가 발생했습니다.",
        );
      }
    });
  };

  const runCreate = () => {
    run(
      () => createUserAccount(draft),
      () => {
        setDraft(emptyDraft);
        setShowCreate(false);
      },
    );
  };

  const runPinReset = (user: ManagedUser) => {
    const pin = pins[user.id] ?? "";
    run(
      () => resetUserPin(user.id, pin),
      () => setPins((current) => ({ ...current, [user.id]: "" })),
    );
  };

  // window.confirm 은 브라우저 설정에 따라 차단될 수 있어 화면 안에서 확인받는다.
  const runDelete = (user: ManagedUser) => {
    run(
      () => deleteUserAccount(user.id),
      () => setConfirmDeleteId(null),
    );
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
            로그인 ID + PIN 6자리 체계입니다. PIN은 조회할 수 없고 재설정만 가능합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700"
          >
            <Plus size={16} />
            계정 직접 생성
          </button>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>
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

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryItem label="전체 회원" value={counts.total} />
        <SummaryItem label="승인 완료" value={counts.active} />
        <SummaryItem label="승인 대기" value={counts.pending} />
        <SummaryItem label="관리자" value={counts.admins} />
      </div>

      {/* 관리자 직접 생성 (임원 등 본인이 신청하지 않는 경우) */}
      {showCreate && (
        <div className="rounded border border-neutral-200 bg-white p-5">
          <h2 className="mb-1 text-base font-bold text-neutral-950">계정 직접 생성</h2>
          <p className="mb-4 text-sm text-neutral-500">
            여기서 만든 계정은 승인 절차 없이 바로 로그인할 수 있습니다.
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            <LabeledInput
              label="이름"
              value={draft.fullName}
              onChange={(value) => setDraft({ ...draft, fullName: value })}
              placeholder="홍길동"
            />
            <LabeledInput
              label="팀"
              value={draft.team}
              onChange={(value) => setDraft({ ...draft, team: value })}
              placeholder="원가관리팀"
            />
            <LabeledInput
              label="회사 이메일"
              type="email"
              value={draft.companyEmail}
              onChange={(value) => setDraft({ ...draft, companyEmail: value })}
              placeholder="XXXXXX@harim-foods.com"
            />
            <LabeledInput
              label="로그인 ID"
              value={draft.loginId}
              onChange={(value) => setDraft({ ...draft, loginId: value.toLowerCase() })}
              placeholder="영문 소문자·숫자 3~20자"
            />
            <LabeledInput
              label="초기 PIN 6자리"
              value={draft.pin}
              onChange={(value) => setDraft({ ...draft, pin: value.replace(/\D/g, "") })}
              placeholder="123456 같은 연속 숫자 불가"
              maxLength={6}
              inputMode="numeric"
            />
            <div>
              <label className="mb-1.5 block text-sm font-bold text-neutral-700">역할</label>
              <div className="flex gap-2">
                <RoleButton
                  active={draft.role === "user"}
                  onClick={() => setDraft({ ...draft, role: "user" })}
                  label="일반 사용자"
                />
                <RoleButton
                  active={draft.role === "admin"}
                  onClick={() => setDraft({ ...draft, role: "admin" })}
                  label="관리자"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={runCreate}
              className="inline-flex h-10 items-center gap-2 rounded bg-neutral-900 px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              <Plus size={16} />
              생성
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setDraft(emptyDraft);
              }}
              className="inline-flex h-10 items-center rounded border border-neutral-300 px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 border-b border-neutral-200">
        {tabs.map((item) => {
          const Icon = item.icon;
          const count =
            item.key === "pending"
              ? counts.pending
              : item.key === "active"
                ? counts.total - counts.pending
                : counts.total;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition-colors ${
                tab === item.key
                  ? "border-[#E53935] text-[#E53935]"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              <Icon size={16} />
              {item.label}
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded border border-neutral-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs font-bold uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3">로그인 ID</th>
                <th className="px-4 py-3">권한/상태</th>
                <th className="px-4 py-3">최근 로그인</th>
                <th className="px-4 py-3">{tab === "roles" ? "역할 변경" : "승인 관리"}</th>
                {tab !== "roles" && <th className="px-4 py-3">PIN 재설정</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibleUsers.map((user) => {
                const locked = isLocked(user);
                const isSelf = user.id === currentUserId;

                return (
                  <tr key={user.id} className="align-top hover:bg-neutral-50/70">
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded bg-neutral-100 text-neutral-600">
                          <UserRound size={18} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-neutral-950">{user.name}</span>
                            {isSelf && (
                              <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                본인
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-neutral-600">
                            <Users size={12} />
                            {user.team}
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                            <Mail size={12} />
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      <div className="font-mono text-sm font-bold text-neutral-900">
                        {user.loginId}
                      </div>
                      <div className="mt-1 text-xs text-neutral-400">
                        가입 {formatDate(user.createdAt)}
                      </div>
                      {locked && (
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">
                          <Lock size={11} />
                          잠김
                        </div>
                      )}
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
                        {user.isAdmin ? (
                          <div className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                            <ShieldCheck size={13} />
                            관리자
                          </div>
                        ) : (
                          <div className="text-xs font-bold text-neutral-500">일반 사용자</div>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 text-neutral-600">{formatDate(user.lastSignInAt)}</td>

                    {tab === "roles" ? (
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isPending || user.isAdmin}
                            onClick={() => run(() => updateUserRole(user.id, "admin"))}
                            className="inline-flex h-9 items-center gap-1.5 rounded bg-red-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                          >
                            <ShieldCheck size={14} />
                            관리자로
                          </button>
                          <button
                            type="button"
                            disabled={isPending || !user.isAdmin || isSelf}
                            title={isSelf ? "본인의 관리자 권한은 해제할 수 없습니다." : undefined}
                            onClick={() => run(() => updateUserRole(user.id, "user"))}
                            className="inline-flex h-9 items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-300"
                          >
                            일반 사용자로
                          </button>
                        </div>
                      </td>
                    ) : (
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {user.status === "active" ? (
                            <button
                              type="button"
                              disabled={isPending || isSelf}
                              title={isSelf ? "본인 계정은 중지할 수 없습니다." : "로그인을 차단합니다."}
                              onClick={() => run(() => updateUserStatus(user.id, "suspended"))}
                              className="inline-flex h-9 items-center gap-1.5 rounded bg-neutral-800 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                            >
                              <Ban size={14} />
                              중지
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isPending}
                              title="이 회원의 로그인을 다시 허용합니다."
                              onClick={() => run(() => updateUserStatus(user.id, "active"))}
                              className="inline-flex h-9 items-center gap-1.5 rounded bg-emerald-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                            >
                              {user.status === "pending" ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />}
                              {user.status === "pending" ? "승인" : "재활성화"}
                            </button>
                          )}

                          {user.status === "pending" && (
                            <button
                              type="button"
                              disabled={isPending}
                              title="가입을 반려합니다. 계정은 남지만 로그인할 수 없습니다."
                              onClick={() => run(() => updateUserStatus(user.id, "rejected"))}
                              className="inline-flex h-9 items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-300"
                            >
                              반려
                            </button>
                          )}

                          {locked && (
                            <button
                              type="button"
                              disabled={isPending}
                              title="PIN 5회 오류로 잠긴 계정을 풉니다."
                              onClick={() => run(() => unlockUser(user.id))}
                              className="inline-flex h-9 items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-700 disabled:opacity-50"
                            >
                              <LockOpen size={14} />
                              잠금 해제
                            </button>
                          )}

                          {confirmDeleteId === user.id ? (
                            <span className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-2 py-1">
                              <span className="text-xs font-bold text-red-700">삭제할까요?</span>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => runDelete(user)}
                                className="h-7 rounded bg-red-600 px-2.5 text-xs font-bold text-white disabled:bg-neutral-300"
                              >
                                예, 삭제
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="h-7 rounded border border-neutral-300 bg-white px-2.5 text-xs font-bold text-neutral-700"
                              >
                                취소
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={isPending || isSelf}
                              title={isSelf ? "본인 계정은 삭제할 수 없습니다." : "계정을 완전히 삭제합니다."}
                              onClick={() => {
                                setMessage(null);
                                setConfirmDeleteId(user.id);
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded border border-red-200 px-3 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-300"
                            >
                              <Trash2 size={14} />
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                    )}

                    {tab !== "roles" && (
                      <td className="px-4 py-4">
                        <div className="flex max-w-[280px] gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={pins[user.id] ?? ""}
                            onChange={(event) =>
                              setPins((current) => ({
                                ...current,
                                [user.id]: event.target.value.replace(/\D/g, ""),
                              }))
                            }
                            placeholder="새 PIN 6자리"
                            className="h-9 min-w-0 flex-1 rounded border border-neutral-300 px-3 text-xs tracking-widest outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                          />
                          <button
                            type="button"
                            disabled={isPending || (pins[user.id] ?? "").length !== 6}
                            onClick={() => runPinReset(user)}
                            className="inline-flex h-9 items-center gap-1.5 rounded bg-red-600 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
                          >
                            <KeyRound size={14} />
                            변경
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!visibleUsers.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-neutral-500">
                    {tab === "pending" ? "승인 대기 중인 회원이 없습니다." : "표시할 회원이 없습니다."}
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
      <div className="mt-2 text-2xl font-bold text-neutral-950">
        {value.toLocaleString("ko-KR")}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text";
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-bold text-neutral-700">{label}</label>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded border border-neutral-300 px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
      />
    </div>
  );
}

function RoleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 flex-1 rounded border text-sm font-bold transition-colors ${
        active
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label}
    </button>
  );
}
