-- S&OP 재고 아침 브리핑용 일별 품목 스냅샷
-- 스냅샷은 서버 전용 service_role 로만 적재/조회한다. 브라우저 공개 금지.

create table if not exists public.snop_inventory_daily_snapshots (
  snapshot_date date not null,
  material_code text not null,
  product_name text not null,
  brand text,
  category text,
  family text,
  production_line text,
  stock_type text,
  storage_scope text,
  unit text,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  stock_value numeric not null default 0,
  min_remain_days integer,
  nearest_expiry date,
  status text not null,
  price_source text not null,
  risk_breakdown jsonb not null default '{}'::jsonb,
  action_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (snapshot_date, material_code),
  constraint snop_inventory_daily_snapshots_status_check
    check (status in ('disposed', 'imminent', 'critical', 'healthy', 'no_expiry'))
);

create index if not exists snop_inventory_daily_snapshots_date_status_idx
  on public.snop_inventory_daily_snapshots (snapshot_date desc, status);

alter table public.snop_inventory_daily_snapshots enable row level security;

-- 공개 API 역할에는 권한을 부여하지 않는다. service_role 은 서버에서 RLS를 우회한다.
revoke all on table public.snop_inventory_daily_snapshots from anon, authenticated;
