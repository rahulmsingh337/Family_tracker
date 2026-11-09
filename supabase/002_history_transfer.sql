-- Run AFTER schema.sql. Adds route history + owner transfer.
create table location_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy real,
  recorded_at timestamptz not null default now()
);
create index on location_history (user_id, recorded_at desc);
alter table location_history enable row level security;

-- Others can see a trail only while that person has sharing ON.
create policy hist_select on location_history for select using (can_see(user_id));
create policy hist_insert on location_history for insert with check (
  user_id = auth.uid() and exists (select 1 from members where user_id = auth.uid() and sharing));
create policy hist_delete on location_history for delete using (user_id = auth.uid());

-- Retention: keep 7 days.
create function trim_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from location_history where user_id = new.user_id and recorded_at < now() - interval '7 days';
  return new;
end $$;
create trigger trg_trim_history after insert on location_history for each row execute function trim_history();

-- Only the owner may remove OTHER members; leaving goes through leave_family().
drop policy mem_delete on members;
create policy mem_delete on members for delete using (
  user_id <> auth.uid() and exists (select 1 from families f where f.id = family_id and f.owner = auth.uid()));

create function transfer_ownership(fid uuid, new_owner uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from families where id = fid and owner = auth.uid()) then
    raise exception 'Only the owner can transfer ownership'; end if;
  if not exists (select 1 from members where family_id = fid and user_id = new_owner) then
    raise exception 'New owner must be a member of this family'; end if;
  update families set owner = new_owner where id = fid;
end $$;

create function leave_family(fid uuid) returns void language plpgsql security definer set search_path = public as $$
declare is_owner boolean; others int;
begin
  select owner = auth.uid() into is_owner from families where id = fid;
  select count(*) into others from members where family_id = fid and user_id <> auth.uid();
  if is_owner and others > 0 then raise exception 'Transfer ownership before leaving'; end if;
  if is_owner then delete from families where id = fid;
  else delete from members where family_id = fid and user_id = auth.uid(); end if;
  if not exists (select 1 from members where user_id = auth.uid()) then
    delete from locations where user_id = auth.uid();
    delete from location_history where user_id = auth.uid();
  end if;
end $$;
