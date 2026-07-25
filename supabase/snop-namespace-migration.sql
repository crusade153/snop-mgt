-- ============================================================
-- S&OP 대시보드 전용 테이블 분리 (snop_ 네임스페이스)
--
-- 배경:
--   이 Supabase 프로젝트 하나를 여러 대시보드가 나눠 쓰고 있다.
--     · 이 대시보드      : profiles / user_favorites / app_notices
--     · 다른 대시보드    : members / posts / tasks / projects
--     · SM 요청관리      : sm_*
--     · 그 외            : app_users / access_users / sm_users
--   profiles 같은 범용 이름은 언제든 다른 프로젝트와 충돌한다.
--   실제로 profiles 11건 중 6건은 다른 대시보드 members.auth_id 와 같은 계정이다.
--
-- 이 스크립트가 하는 일:
--   profiles / user_favorites / user_favorite_customers 를
--   snop_ 접두어를 붙인 전용 테이블로 복제하고 RLS 를 다시 세운다.
--
-- 비파괴 스크립트. 여러 번 실행해도 안전하며 원본 테이블은 손대지 않는다.
--   → 문제가 생기면 코드만 되돌리면 원상복구된다.
--
-- 이 스크립트로 대체되는 것:
--   auth-renewal.sql / admin-role-setup.sql / fix-profiles-rls.sql 의 profiles 부분
--   (기존 파일은 이력 보존용으로 남겨둔다. 다시 실행하지 말 것)
--
-- ⚠️ auth.users 는 여전히 다른 대시보드와 공유된다.
--    같은 Supabase 프로젝트를 쓰는 한 이것만은 분리할 수 없다.
--
-- 실행 위치: Supabase Dashboard > SQL Editor
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. 회원 테이블 : snop_profiles
--    컬럼 구성은 기존 profiles 와 동일하게 맞춘다.
-- ------------------------------------------------------------
create table if not exists public.snop_profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  login_id        text,
  full_name       text,
  team            text,
  email           text,
  company_email   text,
  auth_email      text,
  role            text        not null default 'user',
  status          text        not null default 'pending',
  failed_attempts integer     not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);

-- 로그인 ID 는 대소문자 구분 없이 유일해야 한다. (findProfileByLoginId 가 ilike 로 찾는다)
create unique index if not exists snop_profiles_login_id_key
  on public.snop_profiles (lower(login_id));

create index if not exists snop_profiles_status_idx
  on public.snop_profiles (status);

-- ------------------------------------------------------------
-- 2. 즐겨찾기 테이블 : snop_user_favorites / snop_user_favorite_customers
--
--    원본 user_favorites 에는 FK 가 없어 회원이 지워져도 행이 남았다.
--    "이 대시보드 회원에 딸린 데이터"라는 관계를 명시적으로 건다.
--    (관리자 회원 삭제 시 즐겨찾기가 자동 정리된다)
-- ------------------------------------------------------------
create table if not exists public.snop_user_favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.snop_profiles (id) on delete cascade,
  matnr        text not null,
  product_name text,
  created_at   timestamptz not null default now(),
  constraint snop_user_favorites_user_matnr_key unique (user_id, matnr)
);

create index if not exists snop_user_favorites_user_id_idx
  on public.snop_user_favorites (user_id, created_at desc);

create table if not exists public.snop_user_favorite_customers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.snop_profiles (id) on delete cascade,
  kunnr         varchar not null,
  customer_name varchar,
  created_at    timestamptz not null default now(),
  constraint snop_user_favorite_customers_user_kunnr_key unique (user_id, kunnr)
);

create index if not exists snop_user_favorite_customers_user_id_idx
  on public.snop_user_favorite_customers (user_id, created_at desc);

-- ------------------------------------------------------------
-- 3. 데이터 이관
--    on conflict do nothing 이라 재실행해도 중복되지 않는다.
--    즐겨찾기는 snop_profiles 에 회원이 있는 행만 옮긴다. (FK 위반 방지)
-- ------------------------------------------------------------
insert into public.snop_profiles (
  id, login_id, full_name, team, email, company_email, auth_email,
  role, status, failed_attempts, locked_until, created_at
)
select
  p.id, p.login_id, p.full_name, p.team, p.email, p.company_email, p.auth_email,
  coalesce(p.role, 'user'),
  coalesce(p.status, 'pending'),
  coalesce(p.failed_attempts, 0),
  p.locked_until,
  coalesce(p.created_at, now())
from public.profiles as p
on conflict (id) do nothing;

insert into public.snop_user_favorites (id, user_id, matnr, product_name, created_at)
select f.id, f.user_id, f.matnr, f.product_name, coalesce(f.created_at, now())
from public.user_favorites as f
where exists (select 1 from public.snop_profiles as sp where sp.id = f.user_id)
on conflict (id) do nothing;

insert into public.snop_user_favorite_customers (id, user_id, kunnr, customer_name, created_at)
select c.id, c.user_id, c.kunnr, c.customer_name, coalesce(c.created_at, now())
from public.user_favorite_customers as c
where exists (select 1 from public.snop_profiles as sp where sp.id = c.user_id)
on conflict (id) do nothing;

commit;

-- ------------------------------------------------------------
-- 4. 관리자 판별 함수 : snop_is_admin()
--
--    기존 is_profile_admin() 은 그대로 둔다. 다른 프로젝트가 쓰고 있을 수 있다.
--    이 대시보드는 snop_profiles 만 보는 전용 함수를 쓴다.
--
--    fix-profiles-rls.sql 에서 얻은 교훈을 그대로 적용한다:
--    함수가 예외로 죽으면 정책 전체가 실패해 아무도 프로필을 못 읽는다.
--    어떤 이유로든 오류가 나면 false 를 돌려주고 끝낸다.
-- ------------------------------------------------------------
create or replace function public.snop_is_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  result boolean;
begin
  select exists (
    select 1
    from public.snop_profiles
    where id = auth.uid()
      and role in ('admin', 'administrator')
  ) into result;

  return coalesce(result, false);
exception
  when others then
    return false;
end;
$$;

-- ------------------------------------------------------------
-- 5. RLS : snop_profiles
--
--    '본인 조회'와 '관리자 조회'를 분리한다.
--    본인 조회는 함수 호출 없이 단순 비교만 하므로 절대 실패하지 않는다.
--    미들웨어가 이 경로로 status 를 읽는다. (여러 permissive 정책은 OR 로 결합)
-- ------------------------------------------------------------
alter table public.snop_profiles enable row level security;

grant select, insert, update on public.snop_profiles to authenticated;

drop policy if exists snop_profiles_select_self  on public.snop_profiles;
drop policy if exists snop_profiles_select_admin on public.snop_profiles;
drop policy if exists snop_profiles_update_self  on public.snop_profiles;
drop policy if exists snop_profiles_update_admin on public.snop_profiles;
drop policy if exists snop_profiles_insert_self  on public.snop_profiles;

create policy snop_profiles_select_self
on public.snop_profiles for select to authenticated
using (auth.uid() = id);

create policy snop_profiles_select_admin
on public.snop_profiles for select to authenticated
using (public.snop_is_admin());

create policy snop_profiles_update_self
on public.snop_profiles for update to authenticated
using (auth.uid() = id) with check (auth.uid() = id);

create policy snop_profiles_update_admin
on public.snop_profiles for update to authenticated
using (public.snop_is_admin()) with check (public.snop_is_admin());

create policy snop_profiles_insert_self
on public.snop_profiles for insert to authenticated
with check (auth.uid() = id or public.snop_is_admin());

-- ------------------------------------------------------------
-- 6. RLS : 즐겨찾기
--    즐겨찾기는 본인 것만 읽고 쓴다. 관리자에게도 열지 않는다.
-- ------------------------------------------------------------
alter table public.snop_user_favorites          enable row level security;
alter table public.snop_user_favorite_customers enable row level security;

grant select, insert, update, delete on public.snop_user_favorites          to authenticated;
grant select, insert, update, delete on public.snop_user_favorite_customers to authenticated;

drop policy if exists snop_user_favorites_own           on public.snop_user_favorites;
drop policy if exists snop_user_favorite_customers_own  on public.snop_user_favorite_customers;

create policy snop_user_favorites_own
on public.snop_user_favorites for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy snop_user_favorite_customers_own
on public.snop_user_favorite_customers for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 7. app_notices 정책을 새 관리자 함수로 옮긴다.
--
--    공지는 이 대시보드 전용 테이블인데 관리자 판별만 옛 profiles 를 보고 있었다.
--    이관 후 새로 생긴 관리자는 snop_profiles 에만 있으므로 그대로 두면
--    공지 관리 화면에서 권한이 없다고 나온다.
-- ------------------------------------------------------------
drop policy if exists app_notices_admin_all on public.app_notices;

create policy app_notices_admin_all
on public.app_notices for all
using (public.snop_is_admin()) with check (public.snop_is_admin());

-- ============================================================
-- 8. 검증 — 아래 세 줄 모두 '일치' 여야 한다.
-- ============================================================
select
  '회원' as 대상,
  (select count(*) from public.profiles)      as 원본,
  (select count(*) from public.snop_profiles) as 신규,
  case when (select count(*) from public.profiles) = (select count(*) from public.snop_profiles)
       then '일치' else '불일치' end as 결과
union all
select
  '즐겨찾기(품목)',
  (select count(*) from public.user_favorites),
  (select count(*) from public.snop_user_favorites),
  case when (select count(*) from public.user_favorites) = (select count(*) from public.snop_user_favorites)
       then '일치' else '불일치' end
union all
select
  '즐겨찾기(거래처)',
  (select count(*) from public.user_favorite_customers),
  (select count(*) from public.snop_user_favorite_customers),
  case when (select count(*) from public.user_favorite_customers) = (select count(*) from public.snop_user_favorite_customers)
       then '일치' else '불일치' end;

-- 관리자가 최소 1명은 살아있어야 회원관리에 들어갈 수 있다.
select login_id, full_name, role, status
from public.snop_profiles
where role in ('admin', 'administrator')
order by login_id;

-- 정책 확인 — snop_profiles_select_self 가 반드시 있어야 로그인이 된다.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('snop_profiles', 'snop_user_favorites', 'snop_user_favorite_customers', 'app_notices')
order by tablename, cmd, policyname;
