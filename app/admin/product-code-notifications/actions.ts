"use server";

import { revalidatePath } from "next/cache";
import { createCookieSupabaseClient, getAdminContext } from "@/lib/admin-auth";
import { upsertProductCodeSheetRow } from "@/lib/google-sheets";

export type ProductCodeNotification = {
  id: string; productCode: string; productName: string; reviewStatus: string; note: string;
  notifyChecked: boolean; sentAt: string | null; sentByName: string | null; sheetRow: number | null;
  lastError: string | null; createdAt: string;
};
export type ProductCodeNotificationEvent = {
  id: string; notificationId: string; eventType: string; message: string; actorName: string | null; createdAt: string;
};
type ActionResult = { ok: boolean; message: string };

function actorName(context: Awaited<ReturnType<typeof getAdminContext>>) {
  return String(context.profile?.full_name ?? context.profile?.name ?? context.user?.email ?? "관리자");
}
async function requireAdmin() {
  const context = await getAdminContext();
  if (!context.user || !context.isAdmin) return { ok: false as const, message: "관리자만 제품코드 알림을 관리할 수 있습니다." };
  return { ok: true as const, context, supabase: await createCookieSupabaseClient() };
}
function normalize(row: Record<string, unknown>): ProductCodeNotification {
  return {
    id: String(row.id), productCode: String(row.product_code ?? ""), productName: String(row.product_name ?? ""),
    reviewStatus: String(row.review_status ?? "검토완료"), note: String(row.note ?? ""), notifyChecked: Boolean(row.notify_checked),
    sentAt: typeof row.sent_at === "string" ? row.sent_at : null, sentByName: typeof row.sent_by_name === "string" ? row.sent_by_name : null,
    sheetRow: typeof row.sheet_row === "number" ? row.sheet_row : null, lastError: typeof row.last_error === "string" ? row.last_error : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function getProductCodeNotifications() {
  const guard = await requireAdmin();
  if (!guard.ok) return { notifications: [], events: [], error: guard.message };
  const [notificationsResult, eventsResult] = await Promise.all([
    guard.supabase.from("product_code_notifications").select("*").order("updated_at", { ascending: false }),
    guard.supabase.from("product_code_notification_events").select("*").order("created_at", { ascending: false }).limit(100),
  ]);
  const error = notificationsResult.error ?? eventsResult.error;
  if (error) return { notifications: [], events: [], error: `${error.message} (Supabase SQL Editor에서 supabase/product-code-notifications.sql을 먼저 실행하세요.)` };
  return {
    notifications: (notificationsResult.data ?? []).map(normalize),
    events: (eventsResult.data ?? []).map((row) => ({
      id: String(row.id), notificationId: String(row.notification_id), eventType: String(row.event_type), message: String(row.message),
      actorName: typeof row.actor_name === "string" ? row.actor_name : null, createdAt: String(row.created_at),
    })),
    error: undefined,
  };
}

export async function saveProductCodeNotification(input: { productCode: string; productName: string; reviewStatus: string; note: string }): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const productCode = input.productCode.trim();
  const productName = input.productName.trim();
  if (!productCode || !productName) return { ok: false, message: "제품코드와 제품명을 입력하세요." };
  const { data, error } = await guard.supabase.from("product_code_notifications").upsert({
    product_code: productCode, product_name: productName, review_status: input.reviewStatus.trim() || "검토완료", note: input.note.trim(),
    notify_checked: true, last_error: null, updated_at: new Date().toISOString(),
  }, { onConflict: "product_code" }).select("id").single();
  if (error || !data) return { ok: false, message: error?.message ?? "알림 대상을 저장하지 못했습니다." };
  await guard.supabase.from("product_code_notification_events").insert({
    notification_id: data.id, event_type: "created", message: "전송 대상으로 등록하고 알림 체크했습니다.", actor_id: guard.context.user!.id, actor_name: actorName(guard.context),
  });
  revalidatePath("/admin/product-code-notifications");
  return { ok: true, message: "알림 대상으로 등록했습니다. 체크된 항목을 전송하세요." };
}

export async function setProductCodeNotificationChecked(id: string, checked: boolean): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { error } = await guard.supabase.from("product_code_notifications").update({ notify_checked: checked, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/product-code-notifications");
  return { ok: true, message: checked ? "알림 전송 대상으로 체크했습니다." : "알림 체크를 해제했습니다." };
}

export async function sendCheckedProductCodeNotifications(): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  const { data: notifications, error } = await guard.supabase.from("product_code_notifications").select("*").eq("notify_checked", true).order("updated_at", { ascending: true });
  if (error) return { ok: false, message: error.message };
  if (!notifications?.length) return { ok: false, message: "전송할 알림 체크 항목이 없습니다." };
  const sender = actorName(guard.context);
  let successCount = 0; let failedCount = 0;
  for (const notification of notifications) {
    const sentAt = new Date().toISOString();
    try {
      const result = await upsertProductCodeSheetRow({ productCode: String(notification.product_code), productName: String(notification.product_name), reviewStatus: String(notification.review_status ?? "검토완료"), note: String(notification.note ?? ""), sentAt, sentBy: sender });
      const { error: updateError } = await guard.supabase.from("product_code_notifications").update({
        notify_checked: false, sent_at: sentAt, sent_by: guard.context.user!.id, sent_by_name: sender, sheet_row: result.rowNumber || null, last_error: null, updated_at: sentAt,
      }).eq("id", notification.id);
      if (updateError) throw updateError;
      await guard.supabase.from("product_code_notification_events").insert({
        notification_id: notification.id, event_type: result.operation === "appended" ? "sent" : "updated",
        message: result.operation === "appended" ? `Google Sheets ${result.rowNumber ? `${result.rowNumber}행` : "새 행"}에 전송했습니다.` : `기존 Google Sheets ${result.rowNumber}행을 갱신했습니다.`,
        actor_id: guard.context.user!.id, actor_name: sender,
      });
      successCount += 1;
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Google Sheets 전송에 실패했습니다.";
      await guard.supabase.from("product_code_notifications").update({ last_error: message, updated_at: new Date().toISOString() }).eq("id", notification.id);
      await guard.supabase.from("product_code_notification_events").insert({ notification_id: notification.id, event_type: "failed", message, actor_id: guard.context.user!.id, actor_name: sender });
      failedCount += 1;
    }
  }
  revalidatePath("/admin/product-code-notifications");
  return { ok: failedCount === 0, message: failedCount === 0 ? `${successCount}건을 Google Sheets에 전송했습니다.` : `${successCount}건 전송, ${failedCount}건 실패했습니다. 실패 항목은 체크 상태로 남아 재시도할 수 있습니다.` };
}
