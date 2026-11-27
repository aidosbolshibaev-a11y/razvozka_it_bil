begin;
create index if not exists group_members_group_idx on public.group_members(group_id);
create index if not exists delivery_groups_trip_idx on public.delivery_groups(trip_date,dir,dep_time);
alter table public.delivery_groups alter column driver_id drop not null;
alter table public.delivery_groups add column grouping_method text not null default 'manual' check(grouping_method in ('manual','hex'));
alter table public.group_members add column hex_q integer;
alter table public.group_members add column hex_r integer;
alter table public.common_points add column delivery_lat double precision;
alter table public.common_points add column delivery_lon double precision;
alter table public.common_points add constraint common_point_coords check((delivery_lat is null and delivery_lon is null) or (delivery_lat is not null and delivery_lon is not null and delivery_lat between 50 and 54 and delivery_lon between 69 and 73));
create function public.hex_cell(p_lat double precision,p_lon double precision) returns integer[] language plpgsql immutable set search_path='' as $$
declare x float8;y float8;q float8;r float8;t float8;i int;j int;k int;
begin
 if p_lat is null or p_lon is null or not(p_lat between 50 and 54 and p_lon between 69 and 73) then return null;end if;
 x:=(p_lon-71.43)*111320*cos(radians(51.16));y:=(p_lat-51.16)*111320;
 q:=(sqrt(3.0)/3*x-y/3)/300;r:=(2.0*y/3)/300;t:=-q-r;
 i:=round(q);j:=round(r);k:=round(t);
 if abs(i-q)>abs(j-r) and abs(i-q)>abs(k-t) then i:=-j-k;
 elsif abs(j-r)>abs(k-t) then j:=-i-k;end if;
 return array[i,j];
end;$$;
revoke all on function public.hex_cell(float8,float8) from public,anon,authenticated;
create type public.hex_candidate as (id uuid,lat float8,lon float8,q int,r int,version timestamptz);
alter function public.organizer_dispatch(text,jsonb) rename to organizer_dispatch_v1;
revoke all on function public.organizer_dispatch_v1(text,jsonb) from public,anon,authenticated;
create function public.organizer_dispatch(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare dt date;dr text;tm text;seed record;c record;member_ids uuid[];remaining uuid[];gid uuid;cell int[];created int:=0;added int:=0;missing jsonb:='[]';result jsonb;g public.delivery_groups;snapshot public.hex_candidate[];
begin
 perform public.require_organizer();lock table public.signups in share row exclusive mode;
 if p_action='point_coords' then
  update public.common_points set delivery_lat=(p_data->>'lat')::float8,delivery_lon=(p_data->>'lon')::float8 where id=(p_data->>'id')::uuid;
  if not found then raise exception 'Point not found';end if;
  update public.delivery_groups x set published=false where exists(select 1 from public.group_members m join public.signups s on s.id=m.signup_id where m.group_id=x.id and s.common_point_id=(p_data->>'id')::uuid);
 elsif p_action='assign_driver' then
  select * into strict g from public.delivery_groups where id=(p_data->>'id')::uuid;
  update public.delivery_groups set published=false where trip_date=g.trip_date and dir=g.dir and dep_time=g.dep_time;
  update public.delivery_groups set driver_id=(p_data->>'driver_id')::uuid where id=g.id;
 elsif p_action='auto_group' then
  dt:=(p_data->>'date')::date;dr:=p_data->>'dir';tm:=p_data->>'time';
  if dt is null or dr is null or dr not in ('fri','sun') or not exists(select 1 from public.departure_times where dir=dr and departure=tm) then raise exception 'Invalid trip';end if;
  if now()<public.dl(dt,'car',dr,tm) then raise exception 'Deadline has not passed';end if;
  -- Transaction-local snapshot, never client-supplied coordinates.
  select array_agg(row(s.id,coalesce(s.delivery_lat,p.delivery_lat),coalesce(s.delivery_lon,p.delivery_lon),
   (public.hex_cell(coalesce(s.delivery_lat,p.delivery_lat),coalesce(s.delivery_lon,p.delivery_lon)))[1],
   (public.hex_cell(coalesce(s.delivery_lat,p.delivery_lat),coalesce(s.delivery_lon,p.delivery_lon)))[2],s.updated_at)::public.hex_candidate) into snapshot
  from public.signups s left join public.common_points p on p.id=s.common_point_id
  where s.tr='car' and s.trip_date=dt and s.dir=dr and s.dep_time=tm and not exists(select 1 from public.group_members where signup_id=s.id)
  and public.hex_cell(coalesce(s.delivery_lat,p.delivery_lat),coalesce(s.delivery_lon,p.delivery_lon)) is not null;
  -- Old common-point records predate common_point_id: do not infer coordinates from a matching label.
  select coalesce(jsonb_agg(s.id),'[]') into missing from public.signups s
  where s.tr='car' and s.trip_date=dt and s.dir=dr and s.dep_time=tm and not exists(select 1 from public.group_members where signup_id=s.id)
   and not exists(select 1 from unnest(snapshot) h where h.id=s.id);
  for seed in select * from unnest(snapshot) order by q,r,id loop
   if exists(select 1 from public.group_members where signup_id=seed.id) then continue;end if;
   member_ids:=array[seed.id];
   for c in select * from unnest(snapshot) h where h.id<>seed.id and not exists(select 1 from public.group_members where signup_id=h.id)
    and greatest(abs(h.q-seed.q),abs(h.r-seed.r),abs(h.q+h.r-seed.q-seed.r))<=1
    order by power((h.lat-seed.lat)*111320,2)+power((h.lon-seed.lon)*70000,2),h.id loop
    exit when cardinality(member_ids)>=7;
    if not exists(select 1 from unnest(snapshot) h where h.id=any(member_ids) and power((h.lat-c.lat)*111320,2)+power((h.lon-c.lon)*70000,2)>2250000) then member_ids:=array_append(member_ids,c.id);end if;
   end loop;
   insert into public.delivery_groups(trip_date,dir,dep_time,grouping_method) values(dt,dr,tm,'hex') returning id into gid;
   insert into public.group_members(signup_id,group_id,street,lat,lon,record_version,hex_q,hex_r)
    select id,gid,'Улица не определена (гекс)',lat,lon,version,q,r from unnest(snapshot) where id=any(member_ids);
   created:=created+1;added:=added+cardinality(member_ids);
  end loop;
  if created>0 then update public.delivery_groups set published=false where trip_date=dt and dir=dr and dep_time=tm;end if;
 elsif p_action='publish' then
  select * into strict g from public.delivery_groups where id=(p_data->>'id')::uuid;
  if exists(select 1 from public.delivery_groups where trip_date=g.trip_date and dir=g.dir and dep_time=g.dep_time and driver_id is null) then raise exception 'Assign every driver';end if;
  if exists(select 1 from public.group_members m join public.delivery_groups x on x.id=m.group_id join public.signups s on s.id=m.signup_id left join public.common_points p on p.id=s.common_point_id
    where x.trip_date=g.trip_date and x.dir=g.dir and x.dep_time=g.dep_time and x.grouping_method='hex' and
     (m.lat is distinct from coalesce(s.delivery_lat,p.delivery_lat) or m.lon is distinct from coalesce(s.delivery_lon,p.delivery_lon))) then raise exception 'Coordinates changed; rebuild groups';end if;
  return public.organizer_dispatch_v1(p_action,p_data);
 else return public.organizer_dispatch_v1(p_action,p_data);
 end if;
 result:=public.organizer_dispatch_v1('read');
 return result||jsonb_build_object('auto_result',jsonb_build_object('groups',created,'records',added,'missing',missing));
end;$$;
revoke all on function public.organizer_dispatch(text,jsonb) from public,anon;
grant execute on function public.organizer_dispatch(text,jsonb) to authenticated;
commit;
