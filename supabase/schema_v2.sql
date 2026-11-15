-- Resdagboken uppdatering 2: roller, ta bort medlemmar och ny inbjudningskod.
-- Klistra in allt i Supabase → SQL Editor → New query → Run. Går att köra flera gånger.

alter table public.members add column if not exists role text not null default 'member';

-- Den som skapade dagboken (först med) blir administratör
update public.members m set role = 'admin'
where not exists (select 1 from public.members x where x.role = 'admin' and x.group_id = m.group_id)
  and m.joined_at = (select min(joined_at) from public.members y where y.group_id = m.group_id);

create or replace function public.create_group(p_member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  insert into public.groups default values returning id into g;
  insert into public.members (group_id, user_id, name, role) values (g, auth.uid(), coalesce(nullif(trim(p_member_name), ''), 'Jag'), 'admin');
  return g;
end $$;

create or replace function public.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where group_id = g and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.remove_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_group) then raise exception 'Bara administratören kan ta bort medlemmar'; end if;
  if p_user = auth.uid() then raise exception 'Du kan inte ta bort dig själv'; end if;
  delete from public.members where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_group) then raise exception 'Bara administratören kan ändra roller'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Okänd roll'; end if;
  update public.members set role = p_role where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.new_join_code(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_admin(p_group) then raise exception 'Bara administratören kan byta kod'; end if;
  c := upper(substr(md5(random()::text), 1, 6));
  update public.groups set join_code = c where id = p_group;
  return c;
end $$;

-- Medlemmar får lämna dagboken själva
drop policy if exists members_leave on public.members;
create policy members_leave on public.members for delete using (user_id = auth.uid());

grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.new_join_code(uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
