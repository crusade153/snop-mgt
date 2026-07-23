-- ============================================================
-- 로그인 체계 개편: 로그인 ID + 6자리 PIN
-- 비파괴 스크립트 (컬럼/인덱스/정책 추가만). 여러 번 실행해도 안전.
-- 실행 위치: Supabase Dashboard > SQL Editor
-- ============================================================

-- profiles 테이블이 없을 수도 있으므로 먼저 보장한다.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 기존 컬럼(email/role/status)과 신규 컬럼을 한 번에 보장한다.
alter table public.profiles
  add column if not exists email text,
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists login_id text,
  add column if not exists full_name text,
  add column if not exists team text,
  add column if not exists company_email text,
  add column if not exists auth_email text,
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz;

-- 로그인 ID는 대소문자 구분 없이 유일해야 한다.
create unique index if not exists profiles_login_id_key
  on public.profiles (lower(login_id));

-- 로그인 시 login_id 로 조회하므로 인덱스가 곧 조회 경로가 된다.
create index if not exists profiles_status_idx
  on public.profiles (status);

-- 기존 email 컬럼을 auth 로그인 이메일의 기본값으로 승계한다.
update public.profiles
set auth_email = coalesce(auth_email, company_email, email)
where auth_email is null;

-- ------------------------------------------------------------
-- 관리자 판별 함수
-- 다른 스크립트(notices.sql)도 이 함수를 쓰므로 여기서 확실히 만들어 둔다.
-- profiles.role = 'admin' 이 기본이고, 최초 부트스트랩을 위해
-- 지정 이메일은 프로필이 없어도 관리자로 인정한다.
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
-- RLS: 익명(anon)은 profiles 를 읽을 수 없다.
-- login_id -> auth_email 매핑은 서버에서 service role 로만 수행한다.
-- ------------------------------------------------------------

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_admin_select'
  ) then
    create policy profiles_admin_select
    on public.profiles
    for select
    using (auth.uid() = id or public.is_profile_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_admin_update'
  ) then
    create policy profiles_admin_update
    on public.profiles
    for update
    using (public.is_profile_admin())
    with check (public.is_profile_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_admin_insert'
  ) then
    create policy profiles_admin_insert
    on public.profiles
    for insert
    with check (auth.uid() = id or public.is_profile_admin());
  end if;

  -- 본인 프로필 수정(이름/팀 등)
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_self_update'
  ) then
    create policy profiles_self_update
    on public.profiles
    for update
    using (auth.uid() = id)
    with check (auth.uid() = id);
  end if;
end $$;
