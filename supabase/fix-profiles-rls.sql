-- ============================================================
-- [중요] 승인해도 로그인이 안 되는 문제 수정
--
-- 증상: 회원관리에서는 '승인'으로 보이는데 본인은 계속 승인 대기 화면으로 튕김.
-- 원인: 미들웨어는 '사용자 권한'으로 profiles.status 를 읽는데 RLS 에 막혀
--       0건이 반환됨 → status 가 null 로 보여 미승인으로 처리됨.
--
-- 비파괴 스크립트. 여러 번 실행해도 안전.
-- 실행 위치: Supabase Dashboard > SQL Editor
-- ============================================================

-- ------------------------------------------------------------
-- 1. 관리자 판별 함수를 예외에 안전하게 다시 만든다.
--    이 함수가 실패하면 정책 전체가 실패해 아무도 프로필을 못 읽는다.
--    어떤 이유로든 오류가 나면 false 를 돌려주고 끝낸다.
-- ------------------------------------------------------------
create or replace function public.is_profile_admin()
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
    from public.profiles
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
-- 2. SELECT 정책 재구성
--    '본인 조회'와 '관리자 조회'를 분리한다.
--    본인 조회는 함수 호출 없이 단순 비교만 하므로 절대 실패하지 않는다.
--    (여러 permissive 정책은 OR 로 결합된다)
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;

-- 미들웨어와 getAdminContext 가 사용하는 경로
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy profiles_select_admin
on public.profiles
for select
to authenticated
using (public.is_profile_admin());

-- ------------------------------------------------------------
-- 3. UPDATE / INSERT 정책도 같은 방식으로 정리
--    (회원 상태 변경은 서버가 service role 로 처리하므로 RLS 를 타지 않지만,
--     본인이 자기 이름/팀을 고치는 경로는 남겨둔다)
-- ------------------------------------------------------------
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_insert on public.profiles;

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (public.is_profile_admin())
with check (public.is_profile_admin());

create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (auth.uid() = id or public.is_profile_admin());

-- ------------------------------------------------------------
-- 확인: 아래 결과에 profiles_select_self 가 반드시 있어야 한다.
-- ------------------------------------------------------------
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by cmd, policyname;
