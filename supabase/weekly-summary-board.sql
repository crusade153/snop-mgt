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
  bucket_qty_under50 numeric not null default 0, -- 잔여율 구간별 재고수량
  bucket_qty_50_70 numeric not null default 0,
  bucket_qty_70_75 numeric not null default 0,
  bucket_qty_75_85 numeric not null default 0,
  bucket_qty_85_over numeric not null default 0,

  shipped_qty numeric not null default 0,      -- 주간 출고 (VDATU, LFIMG_LIPS)
  shipped_value numeric not null default 0,    -- 원가단가 환산
  produced_qty numeric not null default 0,     -- 주간 생산 (MB51 101-102)
  produced_value numeric not null default 0,   -- 원가단가 환산
  shipped_mtd_qty numeric not null default 0,  -- 당월 1일~주차 종료일 누적 출고 수량
  shipped_mtd_value numeric not null default 0,-- 원가단가 환산. 「월 출고 比 재고금액」의 분모다
  sales_amount numeric not null default 0,     -- 해당 주 납품매출액(NETWR). 참고용
  sales_mtd numeric not null default 0,        -- 당월 누적 납품매출액(NETWR). 「월 매출 比」의 분모

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

-- ---------------------------------------------------------------------------
-- 4. 누적 출고 열 추가 (2026-08, 이미 만든 테이블에 적용)
--
-- 「월매출 比 재고금액」의 분모를 매출액(NETWR)에서 **누적 출고금액(원가단가 환산)** 으로 바꿨다.
-- 분자인 재고금액은 원가인데 분모가 판매가라 마진율만큼 비율이 눌려 "몇 주치 재고인가"로 읽을 수 없었다.
--
-- ⚠️ 적재보다 먼저 실행해야 한다. 열이 없으면 upsert 가 통째로 실패한다.
-- 과거 주차는 이 열이 0 이므로 화면에서 비율이 `-` 로 나오고, 그 주차를 다시 적재하면 채워진다.
-- ---------------------------------------------------------------------------
alter table public.snop_weekly_inventory_snapshots
  add column if not exists shipped_mtd_qty numeric not null default 0,
  add column if not exists shipped_mtd_value numeric not null default 0;

-- ---------------------------------------------------------------------------
-- 5. 소비기한 잔여 열 (드릴다운 상세표의 「소비기한 임박」 정렬 축)
--
-- 구간별 재고금액(bucket_*)만으로는 "얼마나 임박했나"를 SKU 단위로 줄 세울 수 없다.
-- min_remain_day = 그 SKU·창고그룹에서 가장 임박한 배치의 잔여일.
--   ⚠️ 평균이 아니라 **최솟값**이다. 평균이면 곧 폐기될 소량 배치가 안전한 대량 배치에 묻힌다.
--   ⚠️ 유통기한이 없는 재고뿐이면 null 이다. 0 을 넣으면 '오늘 폐기'로 읽힌다.
-- avg_remain_rate = 금액 가중 평균 잔여율(%). 기한없음 재고는 분모에서 뺀다.
--
-- ⚠️ 재고는 소급 생성이 불가능하므로 **이 열을 추가하기 전에 적재된 주차는 영원히 null** 이다.
--    화면은 그 주차에서 「소비기한 임박」 정렬을 막고 '-' 로 비운다.
-- ---------------------------------------------------------------------------
alter table public.snop_weekly_inventory_snapshots
  add column if not exists min_remain_day numeric,
  add column if not exists avg_remain_rate numeric;

-- ---------------------------------------------------------------------------
-- 6. 소비기한 잔여율 구간별 재고수량 (상세 시트의 수량/금액 병기)
--
-- 기존 bucket_* 열은 금액만 보존하므로 단가가 플랜트별로 다른 SKU 의 정확한 구간 수량을
-- 역산할 수 없다. 적재 시 배치 수량을 같은 구간으로 따로 누적한다.
-- 과거 주차는 기본값 0 으로 남고, 화면은 stock_qty 와 합이 맞지 않으면 '-' 로 표시한다.
-- ---------------------------------------------------------------------------
alter table public.snop_weekly_inventory_snapshots
  add column if not exists bucket_qty_under50 numeric not null default 0,
  add column if not exists bucket_qty_50_70 numeric not null default 0,
  add column if not exists bucket_qty_70_75 numeric not null default 0,
  add column if not exists bucket_qty_75_85 numeric not null default 0,
  add column if not exists bucket_qty_85_over numeric not null default 0;

-- ---------------------------------------------------------------------------
-- 7. 자재 → 제품계층 마스터 (채널별 재고현황 탭의 분류 원천)
--
-- `/weekly` 의 「채널별」 탭은 제품계층 2레벨(SD_MARA.PRDHA_2_T)로 재고를 찢는다.
-- 그런데 이 장표는 **BigQuery 를 읽지 않는다**(주 1회 적재된 스냅샷만 읽는다).
-- 그래서 자재 → 제품계층 마스터를 여기에 한 벌 복사해 두고 조회 때 조인한다.
--
-- ⚠️ **스냅샷 행에 LV2 를 박지 않고 별도 표로 둔 것은 의도다.**
--    제품계층은 측정값이 아니라 기준정보라 소급 적용이 맞다. 별도 표로 두면
--    이 표를 한 번 갱신하는 것만으로 **이미 적재된 과거 주차까지 같은 채널로 접힌다** —
--    스냅샷 열이었다면 주차마다 다시 적재해야 하는데 재고는 소급 생성이 불가능하다.
--    (`dispo` 원본을 보관해 카테고리를 다시 판정하는 것과 같은 원칙이다.)
--
-- 갱신은 주간 적재(`lib/weekly-snapshot.ts`)가 매번 함께 돌리고,
-- 관리자가 화면에서 따로 누를 수도 있다(`refreshMaterialHierarchyAction`).
-- ---------------------------------------------------------------------------
create table if not exists public.snop_material_hierarchy (
  material_code text primary key,
  prdha_1 text,                         -- 브랜드
  prdha_2 text,                         -- 카테고리. 채널 판정의 원천이다
  prdha_3 text,                         -- 제품군
  -- ⚠️ 품명은 일부러 두지 않는다. 화면의 품명은 스냅샷 행(`product_name`)이 원천이고,
  --    여기에 한 벌 더 두면 두 값이 갈렸을 때 어느 쪽이 맞는지 알 수 없게 된다.
  updated_at timestamptz not null default now()
);

create index if not exists snop_material_hierarchy_prdha2_idx
  on public.snop_material_hierarchy (prdha_2);

alter table public.snop_material_hierarchy enable row level security;
revoke all on table public.snop_material_hierarchy from anon, authenticated;
