-- 자재 오너십 — 제품계층에 담당자를 붙여 자재 금액에 이름표를 단다
--
-- 원부포장재는 영업계획에 따라 움직이는데, 마케팅 화면에는 완제품만 있었다.
-- 그래서 자재가 과다발주되거나 사장(死藏)돼도 그 브랜드 담당자에게는 아무 일도
-- 일어나지 않았다. 이 테이블이 그 연결을 만든다.
--
-- 스냅샷/BOM 마트와 같은 관례: 적재·조회는 서버 전용 service_role.

create table if not exists public.snop_product_owners (
  id uuid primary key default gen_random_uuid(),
  -- 제품계층 3레벨 어디에나 붙일 수 있다. 가장 구체적인 매핑이 이긴다:
  -- FAMILY(제품군) > CATEGORY(카테고리) > BRAND(브랜드) > 미지정
  scope_type text not null,
  scope_key text not null,           -- PRDHA_1_T / PRDHA_2_T / PRDHA_3_T 의 값
  owner_id uuid not null references public.snop_profiles(id) on delete cascade,
  owner_name text,                   -- 계정이 삭제돼도 이력은 남아야 한다
  owner_team text,
  role text not null default 'PRIMARY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint snop_product_owners_scope_type_check
    check (scope_type in ('BRAND', 'CATEGORY', 'FAMILY')),
  constraint snop_product_owners_role_check
    check (role in ('PRIMARY', 'BACKUP')),
  unique (scope_type, scope_key, owner_id, role)
);

-- 한 스코프에 주담당(PRIMARY)은 한 명뿐이어야 책임이 갈리지 않는다.
create unique index if not exists snop_product_owners_one_primary_idx
  on public.snop_product_owners (scope_type, scope_key)
  where role = 'PRIMARY';

create index if not exists snop_product_owners_owner_idx
  on public.snop_product_owners (owner_id);


-- 과잉·사장 판정 임계값. 코드에 박으면 현업이 못 고친다.
create table if not exists public.snop_material_thresholds (
  key text primary key,
  value numeric not null,
  note text,
  updated_at timestamptz not null default now()
);

insert into public.snop_material_thresholds (key, value, note) values
  ('usage_lookback_months', 3,  '소요비중·월평균소요를 계산할 과거 생산실적 기간(개월)'),
  ('excess_months',         3,  '재고월수가 이 값을 넘으면 과잉'),
  ('severe_months',         6,  '재고월수가 이 값을 넘으면 심각'),
  ('suspect_qty_per_fg',    10, '완제품 1개당 소요량이 이 값을 넘으면 BOM 검토 대상으로 표시')
on conflict (key) do nothing;


alter table public.snop_product_owners enable row level security;
alter table public.snop_material_thresholds enable row level security;

revoke all on table public.snop_product_owners from anon, authenticated;
revoke all on table public.snop_material_thresholds from anon, authenticated;
