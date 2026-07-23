"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Megaphone, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import NoticePopup from "@/components/notice-popup";
import {
  NOTICE_FREQUENCIES,
  NOTICE_LEVELS,
  type NoticeFrequency,
  type NoticeLevel,
  type NoticeRecord,
} from "@/lib/notice-types";
import { deleteNotice, saveNotice, toggleNotice } from "./actions";

type Props = {
  notices: NoticeRecord[];
  configError?: string;
};

type FormState = {
  id?: string;
  title: string;
  body: string;
  level: NoticeLevel;
  frequency: NoticeFrequency;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
};

const DEFAULT_BODY = `계정 보안 강화 및 퇴사자·장기 미사용 계정 정리를 위해 기존 계정을 모두 초기화했습니다.
기존 이메일·비밀번호로는 접속할 수 없습니다.

아래 절차로 다시 등록해 주세요.
1. 로그인 화면의 [가입 신청] 클릭
2. 이름 · 팀 · 회사 이메일 · 로그인 ID · PIN 6자리 입력
3. 관리자 승인 후 이용 가능

PIN은 앞으로 관리자가 즉시 재설정해 드릴 수 있습니다.
문의: 원가관리팀 유경덕 (yukd2022@harim-foods.com)`;

const emptyForm: FormState = {
  title: "[필수] 보안 정책 변경에 따른 계정 재등록 안내",
  body: DEFAULT_BODY,
  level: "critical",
  frequency: "always",
  isActive: false,
  startsAt: "",
  endsAt: "",
};

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

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

export default function NoticeAdminClient({ notices, configError }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showPreview, setShowPreview] = useState(false);

  const now = Date.now();
  const activeNotice = notices.find((notice) => {
    if (!notice.is_active) return false;
    const startsAt = notice.starts_at ? new Date(notice.starts_at).getTime() : null;
    const endsAt = notice.ends_at ? new Date(notice.ends_at).getTime() : null;
    if (startsAt !== null && startsAt > now) return false;
    if (endsAt !== null && endsAt < now) return false;
    return true;
  });

  const startNew = () => {
    setForm(emptyForm);
    setMessage(null);
  };

  const startEdit = (notice: NoticeRecord) => {
    setForm({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      level: notice.level,
      frequency: notice.frequency,
      isActive: notice.is_active,
      startsAt: toLocalInput(notice.starts_at),
      endsAt: toLocalInput(notice.ends_at),
    });
    setMessage(null);
  };

  const runSave = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveNotice({
        id: form.id,
        title: form.title,
        body: form.body,
        level: form.level,
        frequency: form.frequency,
        isActive: form.isActive,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
      });
      setMessage(result.message);
      if (result.ok) {
        setForm(emptyForm);
        router.refresh();
      }
    });
  };

  const runToggle = (notice: NoticeRecord) => {
    setMessage(null);
    startTransition(async () => {
      const result = await toggleNotice(notice.id, !notice.is_active);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  /**
   * '하루 1회' 공지를 이미 닫았으면 오늘은 다시 뜨지 않는다.
   * 관리자가 확인하려면 이 브라우저의 표시 기록을 지워야 한다.
   */
  const clearSeenRecords = () => {
    try {
      const keys = Object.keys(window.localStorage).filter((key) => key.startsWith("notice:"));
      keys.forEach((key) => window.localStorage.removeItem(key));
      setMessage(
        keys.length
          ? `이 브라우저의 공지 표시 기록 ${keys.length}건을 지웠습니다. 로그인 화면을 새로고침하면 다시 표시됩니다.`
          : "지울 표시 기록이 없습니다. 공지가 안 뜬다면 게시 상태와 게시 기간을 확인해주세요.",
      );
    } catch {
      setMessage("브라우저 저장소에 접근할 수 없습니다.");
    }
  };

  const runDelete = (notice: NoticeRecord) => {
    if (!window.confirm(`"${notice.title}" 공지를 삭제할까요?`)) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deleteNotice(notice.id);
      setMessage(result.message);
      if (result.ok) {
        if (form.id === notice.id) setForm(emptyForm);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      {showPreview && (
        <NoticePopup
          onClose={() => setShowPreview(false)}
          preview={{
            id: "preview",
            title: form.title || "(제목 없음)",
            body: form.body || "(내용 없음)",
            level: form.level,
            frequency: form.frequency,
            updatedAt: new Date().toISOString(),
          }}
        />
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-red-600">
            <Megaphone size={18} />
            Admin
          </div>
          <h1 className="mt-2 text-2xl font-bold text-neutral-950">공지관리</h1>
          <p className="mt-1 text-sm text-neutral-500">
            로그인하지 않은 사용자에게도 표시되는 팝업 공지입니다. 접속이 막힌 직원에게 안내할 때 사용하세요.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clearSeenRecords}
            title="'하루 1회' 공지를 이미 닫았을 때, 이 브라우저에서 다시 뜨게 합니다."
            className="inline-flex h-10 items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            <RotateCcw size={16} />
            내 브라우저에서 다시 보기
          </button>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex h-10 items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
          >
            <Plus size={16} />
            새 공지 작성
          </button>
        </div>
      </div>

      {/* 지금 실제로 팝업이 뜨는 상태인지 한눈에 */}
      <div
        className={`rounded border p-4 text-sm ${
          activeNotice
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-neutral-200 bg-neutral-50 text-neutral-600"
        }`}
      >
        {activeNotice ? (
          <>
            <b>현재 게시 중:</b> {activeNotice.title}
            <span className="ml-2 text-xs">
              ({NOTICE_FREQUENCIES.find((item) => item.value === activeNotice.frequency)?.label} 노출)
            </span>
            <div className="mt-1 text-xs">
              로그인 화면·승인 대기 화면·대시보드 전체에서 팝업이 표시됩니다.
            </div>
          </>
        ) : (
          <>
            <b>게시 중인 공지가 없습니다.</b> 팝업이 뜨지 않습니다. 아래에서 공지를 저장할 때
            <b> 지금 게시하기</b>를 체크하거나, 목록에서 <b>게시</b> 버튼을 눌러주세요.
          </>
        )}
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

      {/* 작성/수정 폼 */}
      <div className="rounded border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-neutral-950">
            {form.id ? "공지 수정" : "새 공지"}
          </h2>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-neutral-300 px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
          >
            <Eye size={14} />
            팝업 미리보기
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-bold text-neutral-700">제목</label>
            <input
              type="text"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="h-10 w-full rounded border border-neutral-300 px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
              placeholder="공지 제목"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold text-neutral-700">
              내용
              <span className="ml-2 text-xs font-normal text-neutral-400">줄바꿈이 그대로 표시됩니다.</span>
            </label>
            <textarea
              rows={10}
              value={form.body}
              onChange={(event) => setForm({ ...form, body: event.target.value })}
              className="w-full rounded border border-neutral-300 p-3 text-sm leading-relaxed outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-bold text-neutral-700">중요도</label>
              <div className="flex gap-2">
                {NOTICE_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setForm({ ...form, level: level.value })}
                    className={`h-10 flex-1 rounded border text-sm font-bold transition-colors ${
                      form.level === level.value
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold text-neutral-700">노출 주기</label>
              <div className="flex gap-2">
                {NOTICE_FREQUENCIES.map((frequency) => (
                  <button
                    key={frequency.value}
                    type="button"
                    onClick={() => setForm({ ...form, frequency: frequency.value })}
                    className={`h-10 flex-1 rounded border text-sm font-bold transition-colors ${
                      form.frequency === frequency.value
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {frequency.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                {NOTICE_FREQUENCIES.find((item) => item.value === form.frequency)?.hint}
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-bold text-neutral-700">
                게시 시작 <span className="text-xs font-normal text-neutral-400">(비우면 즉시)</span>
              </label>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                className="h-10 w-full rounded border border-neutral-300 px-3 text-sm outline-none focus:border-red-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-bold text-neutral-700">
                게시 종료 <span className="text-xs font-normal text-neutral-400">(비우면 무기한)</span>
              </label>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
                className="h-10 w-full rounded border border-neutral-300 px-3 text-sm outline-none focus:border-red-500"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 rounded border border-neutral-200 bg-neutral-50 p-3">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              className="h-4 w-4 accent-red-600"
            />
            <span className="text-sm font-bold text-neutral-800">지금 게시하기</span>
            <span className="text-xs text-neutral-500">체크하면 로그인 화면부터 팝업이 표시됩니다.</span>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={runSave}
              className="inline-flex h-10 items-center gap-2 rounded bg-red-600 px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              <Save size={16} />
              {form.id ? "수정 저장" : "공지 저장"}
            </button>
            {form.id && (
              <button
                type="button"
                onClick={startNew}
                className="inline-flex h-10 items-center rounded border border-neutral-300 px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"
              >
                취소
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 공지 목록 */}
      <div className="overflow-hidden rounded border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-neutral-500">
          등록된 공지 ({notices.length})
        </div>
        <div className="divide-y divide-neutral-100">
          {notices.map((notice) => (
            <div key={notice.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-bold ${
                      notice.is_active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-neutral-300 bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {notice.is_active ? "게시 중" : "중지"}
                  </span>
                  <span className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-bold text-neutral-600">
                    {NOTICE_LEVELS.find((level) => level.value === notice.level)?.label ?? notice.level}
                  </span>
                  <span className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-bold text-neutral-600">
                    {NOTICE_FREQUENCIES.find((item) => item.value === notice.frequency)?.label ?? notice.frequency}
                  </span>
                </div>
                <div className="mt-2 font-bold text-neutral-950">{notice.title}</div>
                <div className="mt-1 line-clamp-2 text-sm text-neutral-500">{notice.body}</div>
                <div className="mt-2 text-xs text-neutral-400">
                  수정 {formatDate(notice.updated_at)}
                  {notice.starts_at && ` · 시작 ${formatDate(notice.starts_at)}`}
                  {notice.ends_at && ` · 종료 ${formatDate(notice.ends_at)}`}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startEdit(notice)}
                  className="h-9 rounded border border-neutral-300 px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  편집
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => runToggle(notice)}
                  className={`h-9 rounded px-3 text-xs font-bold text-white disabled:bg-neutral-300 ${
                    notice.is_active ? "bg-neutral-800" : "bg-emerald-600"
                  }`}
                >
                  {notice.is_active ? "게시 중지" : "게시"}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => runDelete(notice)}
                  className="inline-flex h-9 items-center gap-1 rounded border border-red-200 px-3 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  삭제
                </button>
              </div>
            </div>
          ))}
          {!notices.length && (
            <div className="px-4 py-10 text-center text-sm text-neutral-500">
              등록된 공지가 없습니다. 위에서 첫 공지를 작성해보세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
