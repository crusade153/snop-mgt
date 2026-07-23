-- ============================================================
-- 공지 팝업 (app_notices)
-- 비파괴 스크립트. 여러 번 실행해도 안전.
-- 실행 위치: Supabase Dashboard > SQL Editor
-- ============================================================

create table if not exists public.app_notices (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  level       text not null default 'warning',   -- info | warning | critical
  frequency   text not null default 'daily',     -- daily(하루 1회) | always(접속할 때마다)
  is_active   boolean not null default false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_notices_level_check'
  ) then
    alter table public.app_notices
      add constraint app_notices_level_check
      check (level in ('info', 'warning', 'critical'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'app_notices_frequency_check'
  ) then
    alter table public.app_notices
      add constraint app_notices_frequency_check
      check (frequency in ('daily', 'always'));
  end if;
end $$;

create index if not exists app_notices_active_idx
  on public.app_notices (is_active, updated_at desc);

-- ------------------------------------------------------------
-- 관리자 판별 함수
-- auth-renewal.sql 에도 같은 정의가 있다. 실행 순서에 상관없이 동작하도록
-- 여기서도 만들어 둔다. (create or replace 라 중복 실행해도 안전)
-- ------------------------------------------------------------
create or replace function public.is_profile_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'administrator')
  )
  or exists (
    select 1
    from auth.users
    where id = auth.uid()
      and lower(email) = 'yukd2022@harim-foods.com'
  );
$$;

-- ------------------------------------------------------------
-- RLS
-- anon 에는 select 정책을 주지 않는다.
-- 미인증 사용자의 공지 조회는 /api/notice 가 service role 로 대신 처리한다.
-- (service role 은 RLS 를 우회하므로 별도 정책이 필요 없다)
-- ------------------------------------------------------------
alter table public.app_notices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_notices'
      and policyname = 'app_notices_admin_all'
  ) then
    create policy app_notices_admin_all
    on public.app_notices
    for all
    using (public.is_profile_admin())
    with check (public.is_profile_admin());
  end if;
end $$;

-- updated_at 자동 갱신 (팝업 재노출 판정 키로 쓰인다)
create or replace function public.touch_app_notices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_notices_set_updated_at on public.app_notices;
create trigger app_notices_set_updated_at
  before update on public.app_notices
  for each row execute function public.touch_app_notices_updated_at();
