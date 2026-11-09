-- Run once in Supabase → SQL Editor
create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null references auth.users on delete cascade,
  invite_code text unique not null default substr(replace(gen_random_uuid()::text,'-',''),1,16),
  created_at timestamptz default now()
);
create table members (
  family_id uuid references families on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  name text not null,
  sharing boolean not null default false,
  primary key (family_id, user_id)
);
-- Only the LATEST position per person is stored (no history).
create table locations (
  user_id uuid primary key references auth.users on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy real,
  source text not null default 'gps',
  updated_at timestamptz not null default now()
);

alter table families enable row level security;
alter table members enable row level security;
alter table locations enable row level security;

create function in_family(fid uuid) returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from members where family_id = fid and user_id = auth.uid()) $$;

-- You can see a position only if it's yours, or the owner is sharing and you're in a common family.
create function can_see(owner_id uuid) returns boolean language sql security definer set search_path = public stable as $$
  select owner_id = auth.uid() or exists (
    select 1 from members a join members b on a.family_id = b.family_id
    where a.user_id = auth.uid() and b.user_id = owner_id and b.sharing) $$;

create policy fam_select on families for select using (in_family(id));
create policy fam_delete on families for delete using (owner = auth.uid());

create policy mem_select on members for select using (in_family(family_id));
create policy mem_update on members for update using (user_id = auth.uid());
create policy mem_delete on members for delete using (
  user_id = auth.uid() or exists (select 1 from families f where f.id = family_id and f.owner = auth.uid()));

create policy loc_select on locations for select using (can_see(user_id));
create policy loc_insert on locations for insert with check (
  user_id = auth.uid() and exists (select 1 from members where user_id = auth.uid() and sharing));
create policy loc_update on locations for update using (user_id = auth.uid())
  with check (exists (select 1 from members where user_id = auth.uid() and sharing));
create policy loc_delete on locations for delete using (user_id = auth.uid());

create function create_family(family_name text, member_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into families (name, owner) values (family_name, auth.uid()) returning id into fid;
  insert into members (family_id, user_id, name) values (fid, auth.uid(), member_name);
  return fid;
end $$;

create function family_by_code(code text) returns text language sql security definer set search_path = public stable as $$
  select name from families where invite_code = code $$;

create function join_family(code text, member_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into fid from families where invite_code = code;
  if fid is null then raise exception 'This invite link is no longer valid'; end if;
  insert into members (family_id, user_id, name) values (fid, auth.uid(), member_name) on conflict do nothing;
  return fid;
end $$;

create function rotate_invite(fid uuid) returns text language sql security definer set search_path = public as $$
  update families set invite_code = substr(replace(gen_random_uuid()::text,'-',''),1,16)
  where id = fid and owner = auth.uid() returning invite_code $$;

alter publication supabase_realtime add table locations, members;
