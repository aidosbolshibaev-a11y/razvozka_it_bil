begin;
create table public.trip_deadlines(trip_date date not null,dir text not null check(dir in ('fri','sun')),dep_time text not null,deadline timestamptz not null,primary key(trip_date,dir,dep_time));
alter table public.trip_deadlines enable row level security;
revoke all on public.trip_deadlines from public,anon,authenticated;
create or replace function public.dl(p_date date,p_tr text,p_dir text,p_time text) returns timestamptz language sql stable security definer set search_path='' as $$
 select coalesce((select deadline from public.trip_deadlines where trip_date=p_date and dir=p_dir and dep_time=p_time and p_tr='car'),
 case when p_tr='car' then ((p_date+p_time::time-interval '24 hours') at time zone 'Asia/Almaty')
 else ((p_date-(case when p_dir='fri' then 2 else 3 end)+time '18:00') at time zone 'Asia/Almaty') end);
$$;
create function public.organizer_update_point(p_id uuid,p_address text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v text:=regexp_replace(btrim(p_address),'[[:space:]]+',' ','g');begin
 perform public.require_organizer();lock table public.signups in share row exclusive mode;
 if v is null or length(v) not between 5 and 200 then raise exception 'Invalid address';end if;
 update public.common_points set address=v where id=p_id;if not found then raise exception 'Point not found';end if;
 update public.delivery_groups g set published=false where exists(select 1 from public.group_members m join public.signups s on s.id=m.signup_id where m.group_id=g.id and s.common_point_id=p_id);
 return jsonb_build_object('ok',true);
end;$$;
create function public.organizer_set_deadline(p_date date,p_dir text,p_time text,p_deadline timestamptz,p_reopen boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare old_limit timestamptz;begin
 perform public.require_organizer();lock table public.signups in share row exclusive mode;
 if p_date is null or p_dir is null or p_dir not in ('fri','sun') or not exists(select 1 from public.departure_times where dir=p_dir and departure=p_time) or p_deadline is null or p_deadline>((p_date+p_time::time) at time zone 'Asia/Almaty') then raise exception 'Invalid deadline';end if;
 old_limit:=public.dl(p_date,'car',p_dir,p_time);
 if old_limit<=now() and p_deadline>now() and not coalesce(p_reopen,false) then return jsonb_build_object('error','reopen_confirmation');end if;
 insert into public.trip_deadlines values(p_date,p_dir,p_time,p_deadline) on conflict(trip_date,dir,dep_time) do update set deadline=excluded.deadline;
 update public.delivery_groups set published=false where trip_date=p_date and dir=p_dir and dep_time=p_time;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.organizer_update_point(uuid,text),public.organizer_set_deadline(date,text,text,timestamptz,boolean) from public,anon;
grant execute on function public.organizer_update_point(uuid,text),public.organizer_set_deadline(date,text,text,timestamptz,boolean) to authenticated;
create or replace function public.trip_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'points',coalesce((select jsonb_agg(jsonb_build_object('id',id,'city',city,'address',address) order by city,address) from public.common_points where active),'[]'::jsonb),
 'times',coalesce((select jsonb_agg(jsonb_build_object('dir',dir,'time',departure) order by dir,departure) from public.departure_times),'[]'::jsonb),
 'deadlines',coalesce((select jsonb_agg(jsonb_build_object('date',trip_date,'dir',dir,'time',dep_time,'deadline',deadline)) from public.trip_deadlines where trip_date>=(now() at time zone 'Asia/Almaty')::date),'[]'::jsonb));
$$;
create or replace function public.my_signups(p_phone text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $mine$
declare e text;
begin
 if p_phone is null or p_pin is null then return jsonb_build_object('error','bad_pin');end if;
 e:=public.auth_pin(p_phone,p_pin,false);if e is not null then return jsonb_build_object('error',e);end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'dir',s.dir,'tr',s.tr,'date',s.trip_date,'time',s.dep_time,'name',s.name,'cls',s.cls,'addr',s.addr,'price',s.price,
  'delivery_lat',s.delivery_lat,'delivery_lon',s.delivery_lon,'delivery_note',s.delivery_note,'point_id',s.common_point_id,'deadline',public.dl(s.trip_date,s.tr,s.dir,s.dep_time),'driver',(select jsonb_build_object('name',d.name,'phone',d.phone,'kaspi',d.kaspi) from public.group_members m join public.delivery_groups g on g.id=m.group_id join public.drivers d on d.id=g.driver_id where m.signup_id=s.id and g.published and m.record_version=s.updated_at and g.trip_date=s.trip_date and g.dir=s.dir and g.dep_time=s.dep_time)
 ) order by s.trip_date,s.dep_time,s.id) from public.signups s
 where s.phone=p_phone and s.trip_date>=(now()+interval '5 hours')::date),'[]'::jsonb));
end;
$mine$;
revoke all on function public.my_signups(text,text) from public,authenticated;
grant execute on function public.my_signups(text,text) to anon;


commit;
