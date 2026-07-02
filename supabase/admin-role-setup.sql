alter table public.profiles
  add column if not exists email text,
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'pending';

update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id
  and (profile.email is null or profile.email = '');

update public.profiles
set role = 'user'
where role is null or role = '';

update public.profiles as profile
set
  role = 'admin',
  status = 'active',
  email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id
  and lower(auth_user.email) = 'yukd2022@harim-foods.com';

insert into public.profiles (id, email, role, status)
select auth_user.id, auth_user.email, 'admin', 'active'
from auth.users as auth_user
where lower(auth_user.email) = 'yukd2022@harim-foods.com'
  and not exists (
    select 1
    from public.profiles as profile
    where profile.id = auth_user.id
  );

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

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_admin_select'
  ) then
    create policy profiles_admin_select
    on public.profiles
    for select
    using (auth.uid() = id or public.is_profile_admin());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_admin_update'
  ) then
    create policy profiles_admin_update
    on public.profiles
    for update
    using (public.is_profile_admin())
    with check (public.is_profile_admin());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_admin_insert'
  ) then
    create policy profiles_admin_insert
    on public.profiles
    for insert
    with check (auth.uid() = id or public.is_profile_admin());
  end if;
end $$;
