-- ============================================================
-- ⚠️ 파괴적 스크립트 ⚠️
-- S&OP 대시보드의 회원 정보를 초기화한다. 되돌릴 수 없다.
--
-- ⚠️ 이 Supabase 프로젝트의 auth.users 는 다른 대시보드와 공유된다.
--    public.members 가 참조하는 계정은 그쪽 대시보드의 실사용 계정이므로
--    절대 삭제하지 않는다. (아래 not exists 조건이 그 역할을 한다)
--
-- 실행 전 확인:
--   1. supabase/auth-renewal.sql, supabase/notices.sql 실행 완료
--   2. 새 로그인 화면(ID + PIN)이 배포되어 있는가
--   3. 공지 팝업으로 재가입 안내를 충분히 예고했는가
--
-- 실행 직후 반드시 `node scripts/seed-admin.mjs` 로 관리자 계정을 생성할 것.
-- 그러지 않으면 아무도 로그인할 수 없다.
-- ============================================================

begin;

-- 1. 이 대시보드의 회원 정보를 전부 비운다.
--    user_favorites / user_favorite_customers 는 on delete cascade 라 자동 정리된다.
delete from public.profiles;

-- 2. auth 계정 삭제 — 단, 다른 대시보드(members)가 쓰는 계정은 남긴다.
delete from auth.users u
where not exists (
  select 1 from public.members m where m.auth_id = u.id
);

commit;

-- 확인용
select
  (select count(*) from auth.users)                as 남은_auth계정,
  (select count(*) from public.profiles)           as 대시보드_회원,
  (select count(*) from public.members
     where auth_id is not null)                    as 타대시보드_연결유지,
  (select count(*) from public.user_favorites)     as 즐겨찾기;
