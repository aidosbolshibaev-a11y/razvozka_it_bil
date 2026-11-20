-- Apply after 0001_init.sql and 0002_cleanup.sql in a test project first.
-- Membership is managed only by a trusted database administrator.
begin;

create table public.organizers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.organizers enable row level security;
revoke all on public.organizers from public, anon, authenticated;

create function public.organizer_signups(
  p_date date, p_dir text default null, p_tr text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.organizers o where o.user_id = auth.uid()
  ) then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
  if p_date is null or (p_dir is not null and p_dir not in ('fri','sun'))
     or (p_tr is not null and p_tr not in ('car','train')) then
    raise exception 'Invalid list filters' using errcode = '22023';
  end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'date', s.trip_date, 'dir', s.dir, 'tr', s.tr,
      'time', s.dep_time, 'name', s.name, 'cls', s.cls,
      'phone', s.phone, 'addr', s.addr, 'poa', s.poa, 'price', s.price
    ) order by s.dir, s.tr, s.dep_time, s.cls, s.name, s.id)
    from public.signups s
    where s.trip_date = p_date
      and (p_dir is null or s.dir = p_dir)
      and (p_tr is null or s.tr = p_tr)
  ), '[]'::jsonb));
end;

revoke all on function public.organizer_signups(date,text,text) from public, anon, authenticated;
grant execute on function public.organizer_signups(date,text,text) to authenticated;
comment on function public.organizer_signups(date,text,text) is
  'Read-only daily organizer list. Membership checked on every call; no PIN or parent hashes.';

commit;
