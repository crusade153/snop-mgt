-- Run once in the Supabase SQL Editor before using /admin/product-code-notifications.
-- 선행 조건: snop-namespace-migration.sql (관리자 판별 함수 snop_is_admin 을 만든다)
create table if not exists public.product_code_notifications (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  product_name text not null,
  review_status text not null default '검토완료',
  note text not null default '',
  notify_checked boolean not null default true,
  sent_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_by_name text,
  sheet_row integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_code_notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.product_code_notifications(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'sent', 'updated', 'failed')),
  message text not null,
  actor_id uuid references auth.users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create index if not exists product_code_notification_events_notification_id_created_at_idx on public.product_code_notification_events (notification_id, created_at desc);
alter table public.product_code_notifications enable row level security;
alter table public.product_code_notification_events enable row level security;
grant select, insert, update on public.product_code_notifications to authenticated;
grant select, insert on public.product_code_notification_events to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_code_notifications' and policyname = 'product_code_notifications_admin_all') then
    create policy product_code_notifications_admin_all on public.product_code_notifications for all using (public.snop_is_admin()) with check (public.snop_is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_code_notification_events' and policyname = 'product_code_notification_events_admin_all') then
    create policy product_code_notification_events_admin_all on public.product_code_notification_events for all using (public.snop_is_admin()) with check (public.snop_is_admin());
  end if;
end $$;
