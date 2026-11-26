-- Apply after 0004 in a TEST project first. No existing signup is rewritten.
begin;
create table public.common_points (
 id uuid primary key default gen_random_uuid(),
 city text not null check(city in ('astana','shchuchinsk')),
 address text not null check(length(address) between 5 and 200 and address=btrim(address)),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create unique index common_points_unique on public.common_points(city,lower(address));
create table public.departure_times (
 dir text not null check(dir in ('fri','sun')),
 departure text not null check(departure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 primary key(dir,departure)
);
alter table public.common_points enable row level security;
alter table public.departure_times enable row level security;
revoke all on public.common_points,public.departure_times from public,anon,authenticated;
insert into public.common_points(city,address)
 select city,address from unnest(array['astana','shchuchinsk']) city cross join unnest(array['Точка 1','Точка 2']) address;
insert into public.departure_times(dir,departure)
 select dir,departure from unnest(array['fri','sun']) dir cross join unnest(array['14:00','16:00']) departure;
-- Preserve any previously used valid times too.
insert into public.departure_times select distinct dir,dep_time from public.signups
 where tr='car' and dep_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' on conflict do nothing;
alter table public.signups add column common_point_id uuid references public.common_points(id);

create function public.trip_catalog() returns jsonb
language sql stable security definer set search_path='' as $catalog$
 select jsonb_build_object(
  'points',coalesce((select jsonb_agg(jsonb_build_object('id',id,'city',city,'address',address) order by city,address) from public.common_points where active),'[]'::jsonb),
  'times',coalesce((select jsonb_agg(jsonb_build_object('dir',dir,'time',departure) order by dir,departure) from public.departure_times),'[]'::jsonb));
$catalog$;
revoke all on function public.trip_catalog() from public;
grant execute on function public.trip_catalog() to anon,authenticated;

create function public.organizer_add_point(p_city text,p_address text) returns jsonb
language plpgsql security definer set search_path='' as $point$
declare v_address text:=regexp_replace(btrim(p_address),'[[:space:]]+',' ','g');
begin
 if auth.uid() is null or not exists(select 1 from public.organizers where user_id=auth.uid()) then
  raise exception 'Organizer access required' using errcode='42501';end if;
 if p_city is null or p_city not in ('astana','shchuchinsk') or v_address is null or length(v_address) not between 5 and 200 then
  raise exception 'Invalid common point' using errcode='22023';end if;
 insert into public.common_points(city,address) values(p_city,v_address) on conflict do nothing;
 if not found then return jsonb_build_object('error','duplicate');end if;
 return jsonb_build_object('ok',true);
end;
$point$;
create function public.organizer_add_time(p_dir text,p_time text) returns jsonb
language plpgsql security definer set search_path='' as $time$
begin
 if auth.uid() is null or not exists(select 1 from public.organizers where user_id=auth.uid()) then
  raise exception 'Organizer access required' using errcode='42501';end if;
 if p_dir is null or p_dir not in ('fri','sun') or p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
  raise exception 'Invalid departure time' using errcode='22023';end if;
 insert into public.departure_times(dir,departure) values(p_dir,p_time) on conflict do nothing;
 if not found then return jsonb_build_object('error','duplicate');end if;
 return jsonb_build_object('ok',true);
end;
$time$;
revoke all on function public.organizer_add_point(text,text),public.organizer_add_time(text,text) from public,anon;
grant execute on function public.organizer_add_point(text,text),public.organizer_add_time(text,text) to authenticated;

create or replace function public.upsert_signup(p_id uuid,p_phone text,p_pin text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $upsert$
declare e text; d date; old public.signups;
 v_dir text:=p_data->>'dir'; v_time text:=p_data->>'time';
 v_addr text:=trim(coalesce(p_data->>'addr','')); v_price int;
 v_lat double precision; v_lon double precision; v_note text:='';
 v_point public.common_points; v_point_id uuid; v_city text;
begin
 if p_phone is null or p_pin is null then return jsonb_build_object('error','bad_pin');end if;
 if p_data->>'tr' is distinct from 'car' then return jsonb_build_object('error','car_only');end if;
 if v_dir is null or v_dir not in ('fri','sun') or v_time is null or not exists(select 1 from public.departure_times where dir=v_dir and departure=v_time)
  or length(trim(coalesce(p_data->>'name','')))<5 or coalesce(p_data->>'cls','') !~ '^(7|8|9|10|11)[A-E]$'
  then return jsonb_build_object('error','bad_data');end if;
 begin d:=(p_data->>'date')::date;exception when others then return jsonb_build_object('error','bad_data');end;
 if d is null then return jsonb_build_object('error','bad_data');end if;
 v_city:=case when v_dir='fri' then 'astana' else 'shchuchinsk' end;
 if (p_data ? 'from_city' or p_data ? 'to_city') and
  ((p_data->>'to_city') is distinct from v_city or (p_data->>'from_city') is distinct from
   (case when v_dir='fri' then 'shchuchinsk' else 'astana' end)) then
  return jsonb_build_object('error','bad_cities');end if;
 if nullif(p_data->>'point_id','') is not null then
  begin v_point_id:=(p_data->>'point_id')::uuid;exception when others then return jsonb_build_object('error','addr');end;
  select * into v_point from public.common_points where id=v_point_id and city=v_city and active;
  if not found then return jsonb_build_object('error','addr');end if;
 elsif v_addr<>'' then
  -- Legacy clients choose by canonical address; arbitrary addresses are never trusted.
  select * into v_point from public.common_points where address=v_addr and city=v_city and active;
 end if;
 if v_point.id is not null then v_point_id:=v_point.id;v_addr:=v_point.address;v_price:=5500;
 else
  if v_city<>'astana' then return jsonb_build_object('error','addr');end if;
  begin
   v_lat:=(p_data->>'delivery_lat')::double precision;v_lon:=(p_data->>'delivery_lon')::double precision;
  exception when others then return jsonb_build_object('error','bad_location');end;
  if v_lat is null or v_lon is null or not(v_lat between 50.95 and 51.40 and v_lon between 71.10 and 71.90)
   then return jsonb_build_object('error','bad_location');end if;
  v_lat:=round(v_lat::numeric,6)::double precision;v_lon:=round(v_lon::numeric,6)::double precision;
  v_note:=trim(coalesce(p_data->>'delivery_note',''));
  if length(v_note)>200 then return jsonb_build_object('error','bad_location');end if;
  -- Parent-selected location, NOT a geocoded or verified street address.
  v_addr:='Точка на карте: '||v_lat::text||', '||v_lon::text;v_price:=6500;
 end if;
 if now()>=public.dl(d,'car',v_dir,v_time) then return jsonb_build_object('error','closed');end if;
 e:=public.auth_pin(p_phone,p_pin,true);if e is not null then return jsonb_build_object('error',e);end if;
 if p_id is not null then
  select * into old from public.signups where id=p_id and phone=p_phone for update;
  if not found or old.tr<>'car' or now()>=public.dl(old.trip_date,old.tr,old.dir,old.dep_time)
   then return jsonb_build_object('error','locked_rec');end if;
  update public.signups set dir=v_dir,tr='car',trip_date=d,dep_time=v_time,name=trim(p_data->>'name'),cls=p_data->>'cls',
   addr=v_addr,price=v_price,poa='',delivery_lat=v_lat,delivery_lon=v_lon,delivery_note=v_note,common_point_id=v_point_id,updated_at=now() where id=p_id;
 else
  insert into public.signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price,poa,delivery_lat,delivery_lon,delivery_note,common_point_id)
  values(p_phone,v_dir,'car',d,v_time,trim(p_data->>'name'),p_data->>'cls',v_addr,v_price,'',v_lat,v_lon,v_note,v_point_id);
 end if;
 return jsonb_build_object('ok',true);
end;
$upsert$;
revoke all on function public.upsert_signup(uuid,text,text,jsonb) from public,authenticated;
grant execute on function public.upsert_signup(uuid,text,text,jsonb) to anon;

create or replace function public.my_signups(p_phone text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $mine$
declare e text;
begin
 if p_phone is null or p_pin is null then return jsonb_build_object('error','bad_pin');end if;
 e:=public.auth_pin(p_phone,p_pin,false);if e is not null then return jsonb_build_object('error',e);end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'dir',s.dir,'tr',s.tr,'date',s.trip_date,'time',s.dep_time,'name',s.name,'cls',s.cls,'addr',s.addr,'price',s.price,
  'delivery_lat',s.delivery_lat,'delivery_lon',s.delivery_lon,'delivery_note',s.delivery_note,'point_id',s.common_point_id
 ) order by s.trip_date,s.dep_time,s.id) from public.signups s
 where s.phone=p_phone and s.trip_date>=(now()+interval '5 hours')::date),'[]'::jsonb));
end;
$mine$;
revoke all on function public.my_signups(text,text) from public,authenticated;
grant execute on function public.my_signups(text,text) to anon;

commit;
