"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { CheckSquare, History, RefreshCw, Send, Square } from "lucide-react";
import { saveProductCodeNotification, sendCheckedProductCodeNotifications, setProductCodeNotificationChecked, type ProductCodeNotification, type ProductCodeNotificationEvent } from "./actions";

type Props = { notifications: ProductCodeNotification[]; events: ProductCodeNotificationEvent[]; error?: string };
function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function ProductCodeNotificationsClient({ notifications, events, error }: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ productCode: "", productName: "", reviewStatus: "검토완료", note: "" });
  const checkedCount = useMemo(() => notifications.filter((item) => item.notifyChecked).length, [notifications]);
  const run = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setMessage(null);
    startTransition(async () => setMessage((await action()).message));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(async () => {
      const result = await saveProductCodeNotification(form);
      if (result.ok) setForm({ productCode: "", productName: "", reviewStatus: "검토완료", note: "" });
      return result;
    });
  };

  return <div className="space-y-6 pb-10">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="text-sm font-bold text-blue-700">Admin · Google Sheets</div><h1 className="mt-1 text-2xl font-bold text-neutral-950">제품코드 알림 관리</h1><p className="mt-1 text-sm text-neutral-500">승인 상태와 무관하게, 체크한 제품코드만 수동 전송합니다.</p></div>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex h-10 items-center justify-center gap-2 rounded border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-50"><RefreshCw size={16} /> 새로고침</button>
    </div>
    {error && <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {message && <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-700">{message}</div>}
    <form onSubmit={submit} className="grid gap-3 rounded border border-neutral-200 bg-white p-5 md:grid-cols-2 xl:grid-cols-5">
      <label className="text-sm font-bold text-neutral-700">제품코드<input required value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })} className="mt-1 h-10 w-full rounded border border-neutral-300 px-3 font-mono font-normal" placeholder="예: 10001234" /></label>
      <label className="text-sm font-bold text-neutral-700">제품명<input required value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} className="mt-1 h-10 w-full rounded border border-neutral-300 px-3 font-normal" placeholder="제품명 입력" /></label>
      <label className="text-sm font-bold text-neutral-700">업무 상태<select value={form.reviewStatus} onChange={(event) => setForm({ ...form, reviewStatus: event.target.value })} className="mt-1 h-10 w-full rounded border border-neutral-300 bg-white px-3 font-normal"><option>검토완료</option><option>채번완료</option><option>승인완료</option></select></label>
      <label className="text-sm font-bold text-neutral-700">메모<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="mt-1 h-10 w-full rounded border border-neutral-300 px-3 font-normal" placeholder="선택 입력" /></label>
      <button disabled={isPending} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded bg-neutral-900 px-4 text-sm font-bold text-white disabled:bg-neutral-300"><CheckSquare size={16} /> 등록 및 알림 체크</button>
    </form>
    <div className="overflow-hidden rounded border border-neutral-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-neutral-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-neutral-900">전송 대상</h2><p className="mt-1 text-xs text-neutral-500">동일 제품코드는 시트의 기존 행을 갱신하므로 중복 행이 생기지 않습니다.</p></div><button type="button" disabled={isPending || checkedCount === 0} onClick={() => run(sendCheckedProductCodeNotifications)} className="inline-flex h-10 items-center justify-center gap-2 rounded bg-blue-700 px-4 text-sm font-bold text-white disabled:bg-neutral-300"><Send size={16} /> 체크 {checkedCount}건 Google Sheets 전송</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-sm"><thead className="bg-neutral-50 text-xs font-bold text-neutral-500"><tr><th className="w-28 px-4 py-3">알림 체크</th><th className="px-4 py-3">제품코드</th><th className="px-4 py-3">제품명 / 상태</th><th className="px-4 py-3">최근 전송</th><th className="px-4 py-3">시트 행</th><th className="px-4 py-3">오류</th></tr></thead><tbody className="divide-y divide-neutral-100">
        {notifications.map((item) => <tr key={item.id} className="align-top hover:bg-neutral-50"><td className="px-4 py-3"><button type="button" disabled={isPending} onClick={() => run(() => setProductCodeNotificationChecked(item.id, !item.notifyChecked))} className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-bold ${item.notifyChecked ? "bg-blue-50 text-blue-700" : "bg-neutral-100 text-neutral-600"}`}>{item.notifyChecked ? <CheckSquare size={15} /> : <Square size={15} />}{item.notifyChecked ? "전송 예정" : "미체크"}</button></td><td className="px-4 py-3 font-mono font-bold text-neutral-900">{item.productCode}</td><td className="px-4 py-3"><div className="font-medium text-neutral-900">{item.productName}</div><div className="mt-1 text-xs text-neutral-500">{item.reviewStatus}{item.note ? ` · ${item.note}` : ""}</div></td><td className="px-4 py-3 text-neutral-600">{formatDate(item.sentAt)}{item.sentByName && <div className="mt-1 text-xs text-neutral-400">{item.sentByName}</div>}</td><td className="px-4 py-3 font-mono text-neutral-600">{item.sheetRow ? `${item.sheetRow}행` : "-"}</td><td className="max-w-xs px-4 py-3 text-xs text-red-600">{item.lastError ?? "-"}</td></tr>)}
        {!notifications.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-neutral-500">등록된 제품코드 알림 대상이 없습니다.</td></tr>}
      </tbody></table></div>
    </div>
    <div className="rounded border border-neutral-200 bg-white"><div className="flex items-center gap-2 border-b border-neutral-200 p-4"><History size={17} className="text-neutral-500" /><h2 className="font-bold text-neutral-900">전송 이력</h2></div><div className="divide-y divide-neutral-100">{events.slice(0, 20).map((event) => <div key={event.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><span className="mr-2 rounded bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">{event.eventType}</span>{event.message}</div><div className="text-xs text-neutral-400">{formatDate(event.createdAt)} · {event.actorName ?? "-"}</div></div>)}{!events.length && <div className="px-4 py-10 text-center text-sm text-neutral-500">아직 전송 이력이 없습니다.</div>}</div></div>
  </div>;
}
