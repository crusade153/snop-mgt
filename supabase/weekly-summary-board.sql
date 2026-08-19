-- 주간 완제품 재고 요약장표
--
-- 설계 배경은 docs/weekly-summary-board.md 를 볼 것.
-- 핵심: 재고는 소급 생성이 불가능하므로(BigQuery 는 현재고만 준다) 매주 적재해 쌓는다.
--
-- ⚠️ 집계(CM×공장×카테고리) 단위가 아니라 **SKU × 창고그룹** 단위로 적재한다.
--    CM 매핑이 아직 확정 전이고 제품계층 4레벨로 교체될 예정이라, 접어서 저장하면
--    매핑이 바뀌었을 때 과거 주차를 다시 쪼갤 수 없다.
--
-- 스냅샷은 서버 전용 service_role 로만 적재/조회한다. 브라우저 공개 금지.

-- ---------------------------------------------------------------------------
-- 1. 주간 스냅샷
-- ---------------------------------------------------------------------------
create table if not exists public.snop_weekly_inventory_snapshots (
  week_end_date date not null,          -- 주차 종료 일요일. 주차 키다
  material_code text not null,
  storage_scope text not null,          -- PLANT / LOGISTICS / OTHER

  product_name text,
  dispo text,                           -- 분류의 원천. 카테고리 축을 바꿔도 여기서 다시 접는다
  plant text,                           -- K1/K2/K3/기타 (dispo 파생, 조회 편의용 비정규화)
  category text,                        -- 냉동/HMI/즉석밥/라면/기타 (dispo 파생)
  unit text,

  stock_qty numeric not null default 0,
  stock_value numeric not null default 0,

  bucket_under50 numeric not null default 0,   -- 잔여율 구간별 재고금액
  bucket_50_70 numeric not null default 0,
  bucket_70_75 numeric not null default 0,
  bucket_75_85 numeric not null default 0,
  bucket_85_over numeric not null default 0,

  shipped_qty numeric not null default 0,      -- 주간 출고 (VDATU, LFIMG_LIPS)
  shipped_value numeric not null default 0,    -- 원가단가 환산
  produced_qty numeric not null default 0,     -- 주간 생산 (MB51 101-102)
  produced_value numeric not null default 0,   -- 원가단가 환산
  sales_amount numeric not null default 0,     -- 해당 주 납품매출액(NETWR)
  sales_mtd numeric not null default 0,        -- 당월 1일~주차 종료일 납품매출 누계

  unit_price numeric not null default 0,
  price_month text,                     -- 실제 적용된 단가 기준월 (예: 202606)
  price_source text not null default 'UNKNOWN',

  created_at timestamptz not null default now(),
  primary key (week_end_date, material_code, storage_scope),
  constraint snop_weekly_inventory_snapshots_scope_check
    check (storage_scope in ('PLANT', 'LOGISTICS', 'OTHER'))
);

create index if not exists snop_weekly_inventory_snapshots_week_idx
  on public.snop_weekly_inventory_snapshots (week_end_date desc);

alter table public.snop_weekly_inventory_snapshots enable row level security;
revoke all on table public.snop_weekly_inventory_snapshots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. SKU → CM 매핑
--
-- 제품계층 4레벨이 BigQuery 에 올라오기 전까지 쓰는 임시 기준정보다.
-- 여기 없는 SKU 는 카테고리 기본값(냉동=CM1, HMI·즉석밥=CM2, 라면=CM3)으로 떨어진다.
-- ---------------------------------------------------------------------------
create table if not exists public.snop_cm_mapping (
  material_code text primary key,
  cm_code text not null,
  product_name text,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint snop_cm_mapping_cm_check check (cm_code in ('CM1', 'CM2', 'CM3'))
);

alter table public.snop_cm_mapping enable row level security;
revoke all on table public.snop_cm_mapping from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 비고란 문구
--
-- 고정 텍스트에 값만 치환한 자동 문구가 기본이고, 관리자가 덮어쓰면 그 주차는 수정본이 우선한다.
-- section: 'stock' | 'bucket' | 'issue'
-- ---------------------------------------------------------------------------
create table if not exists public.snop_weekly_board_notes (
  week_end_date date not null,
  section text not null,
  body text not null,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (week_end_date, section)
);

alter table public.snop_weekly_board_notes enable row level security;
revoke all on table public.snop_weekly_board_notes from anon, authenticated;
