begin;
create function public.require_organizer() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organizers where user_id=auth.uid()) then raise exception 'Organizer access required' using errcode='42501';end if;
end;$$;
revoke all on function public.require_organizer() from public,anon,authenticated;
create table public.drivers(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 2 and 120),phone text not null check(phone ~ '^7[0-9]{10}$'),kaspi text not null check(kaspi ~ '^[0-9]{10,20}$'));
create table public.delivery_groups(id uuid primary key default gen_random_uuid(),trip_date date not null,dir text not null check(dir in ('fri','sun')),dep_time text not null,driver_id uuid not null references public.drivers(id),published boolean not null default false);
create table public.group_members(signup_id uuid primary key references public.signups(id) on delete cascade,group_id uuid not null references public.delivery_groups(id) on delete cascade,street text not null check(length(street) between 2 and 160),lat double precision not null check(lat between 50 and 54),lon double precision not null check(lon between 69 and 73),record_version timestamptz not null);
alter table public.drivers enable row level security;
alter table public.delivery_groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.drivers,public.delivery_groups,public.group_members from public,anon,authenticated;
create function public.invalidate_trip_groups() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then update public.delivery_groups set published=false where trip_date=old.trip_date and dir=old.dir and dep_time=old.dep_time;end if;
 if tg_op<>'DELETE' then update public.delivery_groups set published=false where trip_date=new.trip_date and dir=new.dir and dep_time=new.dep_time;end if;
 return null;
end;$$;
revoke all on function public.invalidate_trip_groups() from public,anon,authenticated;
create trigger invalidate_trip_groups after insert or update or delete on public.signups for each row execute function public.invalidate_trip_groups();
create function public.organizer_dispatch(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drivers;g public.delivery_groups;s public.signups;m jsonb;gid uuid;dt date;dr text;tm text;ids uuid[];n int;
begin
 perform public.require_organizer();
 -- Serialize dispatch and signup changes, including publication rechecks.
 lock table public.signups in share row exclusive mode;
 if p_action='driver' then
  insert into public.drivers(name,phone,kaspi) values(btrim(p_data->>'name'),p_data->>'phone',p_data->>'kaspi');
 elsif p_action='edit' then
  select * into strict s from public.signups where id=(p_data->>'id')::uuid and tr='car' for update;
  if (p_data->>'version')::timestamptz is distinct from s.updated_at then raise exception 'Record changed; reload';end if;
  if length(btrim(coalesce(p_data->>'name','')))<5 or length(btrim(coalesce(p_data->>'addr','')))<5 then raise exception 'Name and address required';end if;
  dt:=(p_data->>'date')::date;tm:=p_data->>'time';
  if dt is null or not exists(select 1 from public.departure_times where dir=s.dir and departure=tm) then raise exception 'Invalid trip';end if;
  update public.signups set name=btrim(p_data->>'name'),addr=btrim(p_data->>'addr'),trip_date=dt,dep_time=tm,
   delivery_lat=case when addr=btrim(p_data->>'addr') then delivery_lat else null end,
   delivery_lon=case when addr=btrim(p_data->>'addr') then delivery_lon else null end,
   common_point_id=case when addr=btrim(p_data->>'addr') then common_point_id else null end,updated_at=clock_timestamp() where id=s.id;
 elsif p_action='cancel' then
  delete from public.signups where id=(p_data->>'id')::uuid and tr='car' and updated_at=(p_data->>'version')::timestamptz;if not found then raise exception 'Record not found';end if;
 elsif p_action='remove_group' then
  select * into strict g from public.delivery_groups where id=(p_data->>'id')::uuid;
  update public.delivery_groups set published=false where trip_date=g.trip_date and dir=g.dir and dep_time=g.dep_time;
  delete from public.delivery_groups where id=g.id;
 elsif p_action='group' then
  if jsonb_typeof(p_data->'members') is distinct from 'array' then raise exception 'Members required';end if;
  n:=jsonb_array_length(p_data->'members');if n<1 or n>7 then raise exception 'Group size: 1..7';end if;
  select * into strict s from public.signups where id=(p_data->'members'->0->>'id')::uuid and tr='car';
  dt:=s.trip_date;dr:=s.dir;tm:=s.dep_time;
  if now()<public.dl(dt,'car',dr,tm) then raise exception 'Deadline has not passed';end if;
  insert into public.delivery_groups(trip_date,dir,dep_time,driver_id) values(dt,dr,tm,(p_data->>'driver_id')::uuid) returning id into gid;
  for m in select value from jsonb_array_elements(p_data->'members') loop
   select * into strict s from public.signups where id=(m->>'id')::uuid and tr='car' and trip_date=dt and dir=dr and dep_time=tm;
   if (m->>'version')::timestamptz is distinct from s.updated_at then raise exception 'Record changed; reload';end if;
   if m->>'verified' is distinct from 'true' then raise exception 'Confirm building and street';end if;
   insert into public.group_members values(s.id,gid,lower(btrim(m->>'street')),(m->>'lat')::float8,(m->>'lon')::float8,s.updated_at);
  end loop;
  if (select count(distinct street) from public.group_members where group_id=gid)>4 then raise exception 'Maximum 4 streets';end if;
  -- Conservative proximity bound, in addition to manual building/street confirmation.
  if exists(select 1 from public.group_members a cross join public.group_members b where a.group_id=gid and b.group_id=gid and
   power((a.lat-b.lat)*111320,2)+power((a.lon-b.lon)*70000,2)>power(1500,2)) then raise exception 'Addresses are farther than 1500 m';end if;
  update public.delivery_groups set published=false where trip_date=dt and dir=dr and dep_time=tm;
 elsif p_action='publish' then
  select * into strict g from public.delivery_groups where id=(p_data->>'id')::uuid;
  if now()<public.dl(g.trip_date,'car',g.dir,g.dep_time) then raise exception 'Deadline has not passed';end if;
  if exists(select 1 from public.signups s left join public.group_members m on m.signup_id=s.id left join public.delivery_groups x on x.id=m.group_id
   where s.tr='car' and s.trip_date=g.trip_date and s.dir=g.dir and s.dep_time=g.dep_time and
    (x.id is null or x.trip_date<>s.trip_date or x.dir<>s.dir or x.dep_time<>s.dep_time or m.record_version<>s.updated_at)) then raise exception 'Every active record needs an up-to-date group';end if;
  if exists(select 1 from public.delivery_groups x left join public.group_members m on m.group_id=x.id left join public.signups s on s.id=m.signup_id
   where x.trip_date=g.trip_date and x.dir=g.dir and x.dep_time=g.dep_time and
   (s.id is null or s.trip_date<>x.trip_date or s.dir<>x.dir or s.dep_time<>x.dep_time or s.updated_at<>m.record_version)) then raise exception 'Rebuild stale groups';end if;
  update public.delivery_groups set published=true where trip_date=g.trip_date and dir=g.dir and dep_time=g.dep_time;
 elsif p_action<>'read' then raise exception 'Unknown action';end if;
 return jsonb_build_object('drivers',coalesce((select jsonb_agg(to_jsonb(x)) from public.drivers x),'[]'::jsonb),
 'groups',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('members',(select jsonb_agg(signup_id) from public.group_members where group_id=x.id))) from public.delivery_groups x),'[]'::jsonb));
end;$$;
revoke all on function public.organizer_dispatch(text,jsonb) from public,anon;
grant execute on function public.organizer_dispatch(text,jsonb) to authenticated;
create or replace function public.my_signups(p_phone text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $mine$
declare e text;
begin
 if p_phone is null or p_pin is null then return jsonb_build_object('error','bad_pin');end if;
 e:=public.auth_pin(p_phone,p_pin,false);if e is not null then return jsonb_build_object('error',e);end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'dir',s.dir,'tr',s.tr,'date',s.trip_date,'time',s.dep_time,'name',s.name,'cls',s.cls,'addr',s.addr,'price',s.price,
  'delivery_lat',s.delivery_lat,'delivery_lon',s.delivery_lon,'delivery_note',s.delivery_note,'point_id',s.common_point_id,'driver',(select jsonb_build_object('name',d.name,'phone',d.phone,'kaspi',d.kaspi) from public.group_members m join public.delivery_groups g on g.id=m.group_id join public.drivers d on d.id=g.driver_id where m.signup_id=s.id and g.published and m.record_version=s.updated_at and g.trip_date=s.trip_date and g.dir=s.dir and g.dep_time=s.dep_time)
 ) order by s.trip_date,s.dep_time,s.id) from public.signups s
 where s.phone=p_phone and s.trip_date>=(now()+interval '5 hours')::date),'[]'::jsonb));
end;
$mine$;
revoke all on function public.my_signups(text,text) from public,authenticated;
grant execute on function public.my_signups(text,text) to anon;

create or replace function public.organizer_signups(p_date date,p_dir text default null,p_tr text default null) returns jsonb
language plpgsql security definer set search_path='' as $organizer$
begin
 if auth.uid() is null or not exists(select 1 from public.organizers o where o.user_id=auth.uid()) then
  raise exception 'Organizer access required' using errcode='42501';end if;
 if p_date is null or (p_dir is not null and p_dir not in ('fri','sun')) or (p_tr is not null and p_tr<>'car') then
  raise exception 'Invalid list filters' using errcode='22023';end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'date',s.trip_date,'dir',s.dir,'tr',s.tr,'time',s.dep_time,'name',s.name,'cls',s.cls,'phone',s.phone,'addr',s.addr,'price',s.price,
  'delivery_lat',s.delivery_lat,'delivery_lon',s.delivery_lon,'delivery_note',s.delivery_note,'updated_at',s.updated_at
 ) order by s.dir,s.dep_time,s.cls,s.name,s.id) from public.signups s
 where s.trip_date=p_date and s.tr='car' and(p_dir is null or s.dir=p_dir)),'[]'::jsonb));
end;
$organizer$;
revoke all on function public.organizer_signups(date,text,text) from public,anon;
grant execute on function public.organizer_signups(date,text,text) to authenticated;

commit;
