-- BOM 리프 마트 — 완제품 1 기본단위당 자재 소요량
--
-- 조직 어디에도 없던 "전개된 BOM" 계층이다. 사내 5개 앱이 지금까지 PP_STPO 를
-- 각자 매번 재귀 전개하고 있었다. 여기 한 번 적재해두면 자재코드로 역조회가
-- 인덱스 한 번에 끝난다("이 포장재를 쓰는 완제품은?" → 이 앱의 존재 이유).
--
-- 적재는 관리자가 /admin/bom 에서 수동 재빌드할 때만 일어난다(크론 없음).
-- BOM 은 거의 변하지 않으므로 이걸로 충분하고, 나중에 크론을 붙일 때는
-- 같은 rebuildBomMart() 를 호출하는 라우트 하나만 추가하면 된다.
--
-- 규모(2026-08-07 실측, 원재료+부재료+포장재): 51,763행 / 자재 3,087 / 완제품 1,932.
-- 자재 구분별로는 원재료 3,646 · 부재료 39,904 · 포장재 8,213 행이다.
-- 이 테이블은 자재코드로 완제품을 되짚는 드릴다운 전용이다. 화면 목록에 쓰는
-- 소요량 집계는 BigQuery 에서 접어 온다(lib/material/requirement-sql.ts) —
-- 5만행을 매 요청마다 1,000행씩 나눠 받는 건 못 쓰기 때문이다.
--
-- 스냅샷 테이블과 같은 관례: 서버 전용 service_role 로만 적재/조회. 브라우저 공개 금지.

create table if not exists public.snop_bom_leaf (
  root_matnr text not null,          -- 완제품
  material_code text not null,       -- 자재 (1차 스코프: 포장재 3*)
  werks text not null,               -- 공장. 1031(온라인물류센터)도 세트조립으로 자재를 쓴다
  root_name text,
  root_brand text,                   -- PRDHA_1_T
  root_category text,                -- PRDHA_2_T
  root_family text,                  -- PRDHA_3_T. 담당자 매핑의 기본 단위
  root_uom text,
  material_name text,
  material_class char(1),            -- 자재대역 앞자리. 1=원재료 2=부재료 3=포장재
  bom_uom text,                      -- BOM 구성품 단위
  base_uom text,                     -- 자재 마스터 기본단위
  -- MARM(단위환산) 테이블이 사내 BigQuery 에 없다. 추정하지 않고 표시만 한다.
  -- 실측(2026-08-07): 포장재 2,744쌍 중 불일치 1건, 마스터 누락 0건.
  uom_mismatch boolean not null default false,

  qty_per_fg numeric not null default 0,   -- 완제품 1 기본단위당 누적 소요량 (전 경로 합산)

  -- ── 신뢰도 플래그. 전부 "계산에서 빼야 하는 이유"이며 화면에 뱃지로 뜬다 ──
  -- 로트 고정수량(FMENG='X'). 완제품 1개당으로 환산 불가라 계수를 0으로 뒀다.
  has_fixed_qty boolean not null default false,
  -- MENGE(STRING) 파싱 실패. 실측 전체 63행.
  has_bad_qty boolean not null default false,
  -- 기준수량(BMENG) 오등록. BMENG=1 인데 자식 소요가 100 초과 → 실제로는 로트 기준.
  -- 실측: 부모 6,396개 중 11개. 예) 50003114 는 3,475봉지 로트 기준인데 BMENG=1.
  suspect_lot_basis boolean not null default false,
  -- 대안 BOM 개수. MIN(STLAL) 은 조직 관례일 뿐 진실이 아니다. 1보다 크면 화면에 알린다.
  stlal_count smallint not null default 1,

  min_level smallint,                -- 1=직접 투입, 2+=반제품 경유
  max_level smallint,
  path_count integer not null default 1,
  hit_depth_cap boolean not null default false,
  via_paths jsonb not null default '[]'::jsonb,   -- 경유 반제품 체인, 최대 5개

  build_id uuid not null,
  built_at timestamptz not null default now(),
  primary key (root_matnr, material_code, werks)
);

-- 역전개(자재 → 완제품)가 주 조회 방향이다. 이 인덱스가 핵심.
create index if not exists snop_bom_leaf_material_idx
  on public.snop_bom_leaf (material_code, werks);
-- 정전개(완제품 → 자재). 제품 상세 화면용.
create index if not exists snop_bom_leaf_root_idx
  on public.snop_bom_leaf (root_matnr, werks);
-- 담당자 스코프 집계용.
create index if not exists snop_bom_leaf_family_idx
  on public.snop_bom_leaf (root_family);


-- 수동 재빌드는 잊히기 쉽다. "언제 만든 데이터인가"를 항상 답할 수 있어야 한다.
-- /materials 화면 상단에 built_at 을 상시 표시하고 14일 초과 시 경고 배너를 띄운다.
create table if not exists public.snop_bom_build_runs (
  build_id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'RUNNING',
  scope text not null default 'PACKAGING',
  triggered_by uuid references public.snop_profiles(id) on delete set null,
  triggered_by_name text,            -- 계정이 삭제돼도 이력은 남아야 한다
  row_count integer,
  root_count integer,
  material_count integer,
  bq_ms integer,
  depth_cap_hits integer,
  uom_mismatch_count integer,
  suspect_lot_basis_count integer,
  error_message text,
  constraint snop_bom_build_runs_status_check
    check (status in ('RUNNING', 'SUCCESS', 'FAILED')),
  constraint snop_bom_build_runs_scope_check
    check (scope in ('PACKAGING', 'RAW_AND_PACKAGING'))
);

create index if not exists snop_bom_build_runs_started_idx
  on public.snop_bom_build_runs (started_at desc);


-- 단위 불일치 수동 보정. MARM 이 없으므로 실측 후 필요한 건만 채운다.
-- 현재 포장재 스코프에서는 불일치가 1건뿐이라 비어 있어도 무방하다.
create table if not exists public.snop_bom_uom_overrides (
  material_code text primary key,
  from_uom text not null,
  to_uom text not null,
  factor numeric not null,
  note text,
  created_at timestamptz not null default now()
);


alter table public.snop_bom_leaf enable row level security;
alter table public.snop_bom_build_runs enable row level security;
alter table public.snop_bom_uom_overrides enable row level security;

-- 공개 API 역할에는 권한을 부여하지 않는다. service_role 은 서버에서 RLS를 우회한다.
revoke all on table public.snop_bom_leaf from anon, authenticated;
revoke all on table public.snop_bom_build_runs from anon, authenticated;
revoke all on table public.snop_bom_uom_overrides from anon, authenticated;
