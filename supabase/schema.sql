-- Resdagboken: databas, behörigheter och bildlagring.
-- Klistra in allt i Supabase → SQL Editor → New query → Run. Går att köra flera gånger.

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Vår resdagbok',
  join_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.docs (
  id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists docs_group_updated on public.docs (group_id, updated_at);

create or replace function public.touch_doc() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.touch_doc();

create or replace function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where group_id = g and user_id = auth.uid());
$$;

alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.docs enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select using (public.is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (public.is_member(group_id));
drop policy if exists members_rename on public.members;
create policy members_rename on public.members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists docs_all on public.docs;
create policy docs_all on public.docs for all
  using (public.is_member(group_id)) with check (public.is_member(group_id));

create or replace function public.create_group(p_member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  insert into public.groups default values returning id into g;
  insert into public.members (group_id, user_id, name) values (g, auth.uid(), coalesce(nullif(trim(p_member_name), ''), 'Jag'));
  return g;
end $$;

create or replace function public.join_group(p_code text, p_member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  select id into g from public.groups where join_code = upper(trim(p_code));
  if g is null then raise exception 'Fel kod'; end if;
  insert into public.members (group_id, user_id, name) values (g, auth.uid(), coalesce(nullif(trim(p_member_name), ''), 'Jag'))
    on conflict (group_id, user_id) do update set name = excluded.name;
  return g;
end $$;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;

-- Bilder och videor: privat lagring, mapp = gruppens id
insert into storage.buckets (id, name, public) values ('media', 'media', false)
  on conflict (id) do nothing;

drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
