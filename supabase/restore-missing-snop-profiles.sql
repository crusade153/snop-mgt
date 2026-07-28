-- ============================================================
-- 누락된 회원 프로필 복구 (snop_profiles)
--
-- 무슨 일이 있었나:
--   2026-07-25 에 snop-namespace-migration.sql 을 실행해 profiles → snop_profiles
--   8건을 옮겼다. 그런데 그 코드 변경(커밋 b6ae004)은 로컬에만 있었고
--   프로덕션은 계속 구 코드로 돌아서, 7/26~7/28 에 가입한 17명이
--   구 profiles 에만 쌓였다.
--
--   2026-07-28 에 b6ae004 가 배포되면서 관리자 화면이 snop_profiles 를 보게 됐고,
--   그 17명이 갑자기 "승인 대기 / 로그인ID -" 로 나타났다.
--   승인 버튼은 `update snop_profiles ... where id = ?` 라 0행만 건드려
--   성공 메시지만 뜨고 상태는 그대로였다.
--
-- 이 스크립트가 하는 일:
--   auth 계정이 살아있는데 snop_profiles 에만 없는 회원을 구 profiles 에서 되살린다.
--   status/role 을 원래 값 그대로 가져오므로 승인 상태가 복원된다.
--
-- 추가(insert)만 한다. 기존 snop_profiles 행은 건드리지 않는다.
-- 여러 번 실행해도 안전하다.
--
-- 실행 위치: Supabase Dashboard > SQL Editor
-- ============================================================

begin;

-- 1. 복구 전 상태
select
  '복구 전' as 시점,
  (select count(*) from public.snop_profiles) as snop_profiles,
  (select count(*) from public.profiles)      as 구_profiles,
  (select count(*) from auth.users)           as auth_users;

-- 2. 복구할 대상 미리보기
select p.login_id, p.full_name, p.team, p.status, p.role, p.created_at
from public.profiles as p
join auth.users as u on u.id = p.id
where not exists (select 1 from public.snop_profiles as sp where sp.id = p.id)
order by p.created_at;

-- 3. 복구
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
join auth.users as u on u.id = p.id          -- 삭제된 계정은 되살리지 않는다
where not exists (select 1 from public.snop_profiles as sp where sp.id = p.id)
on conflict (id) do nothing;

commit;

-- ============================================================
-- 4. 검증 — '정상' 이 나와야 한다.
-- ============================================================
select
  '복구 후' as 시점,
  (select count(*) from public.snop_profiles) as snop_profiles,
  (select count(*) from public.profiles)      as 구_profiles,
  (select count(*) from auth.users)           as auth_users;

-- 승인 상태 분포
select status, count(*) as 인원
from public.snop_profiles
group by status
order by status;

-- 아직 프로필이 없는 auth 계정 (다른 대시보드 전용 계정이면 정상이다)
select u.id, u.email, u.created_at
from auth.users as u
where not exists (select 1 from public.snop_profiles as sp where sp.id = u.id)
order by u.created_at;

-- 로그인 ID 중복은 없어야 한다 (있으면 로그인이 엉킨다)
select lower(login_id) as login_id, count(*) as 건수
from public.snop_profiles
where login_id is not null
group by lower(login_id)
having count(*) > 1;
