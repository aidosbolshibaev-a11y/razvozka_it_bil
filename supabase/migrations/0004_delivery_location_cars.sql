-- Apply after 0001..0003 in a TEST project first. Existing records are preserved.
begin;
alter table public.signups add column delivery_lat double precision;
alter table public.signups add column delivery_lon double precision;
alter table public.signups add column delivery_note text not null default '';
alter table public.signups add constraint delivery_location_bounds check (
 (delivery_lat is null and delivery_lon is null) or
 (delivery_lat is not null and delivery_lon is not null
  and delivery_lat between 50.95 and 51.40 and delivery_lon between 71.10 and 71.90)
);
alter table public.signups add constraint delivery_note_length check (length(delivery_note)<=200);

create function public.only_car_writes() returns trigger language plpgsql set search_path='' as $guard$
begin
 if new.tr is distinct from 'car' then raise exception 'Only cars accepted' using errcode='23514'; end if;
 if tg_op='UPDATE' then
  if old.tr<>'car' then raise exception 'Archived record' using errcode='23514';end if;
 end if;
 return new;
end;
$guard$;
create trigger signups_only_car_writes before insert or update on public.signups
for each row execute function public.only_car_writes();

create or replace function public.upsert_signup(p_id uuid,p_phone text,p_pin text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $upsert$
declare e text; d date; old public.signups;
 v_dir text:=p_data->>'dir'; v_time text:=p_data->>'time';
 v_addr text:=trim(coalesce(p_data->>'addr','')); v_price int;
 v_lat double precision; v_lon double precision; v_note text:='';
begin
 if p_phone is null or p_pin is null then return jsonb_build_object('error','bad_pin');end if;
 if p_data->>'tr' is distinct from 'car' then return jsonb_build_object('error','car_only');end if;
 if v_dir is null or v_dir not in ('fri','sun') or v_time is null or v_time not in ('14:00','16:00')
  or length(trim(coalesce(p_data->>'name','')))<5 or coalesce(p_data->>'cls','') !~ '^(7|8|9|10|11)[A-E]$'
  then return jsonb_build_object('error','bad_data');end if;
 begin d:=(p_data->>'date')::date;exception when others then return jsonb_build_object('error','bad_data');end;
 if d is null then return jsonb_build_object('error','bad_data');end if;
 if v_addr in ('Точка 1','Точка 2') then v_price:=5500;
 else
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
   addr=v_addr,price=v_price,poa='',delivery_lat=v_lat,delivery_lon=v_lon,delivery_note=v_note,updated_at=now() where id=p_id;
 else
  insert into public.signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price,poa,delivery_lat,delivery_lon,delivery_note)
  values(p_phone,v_dir,'car',d,v_time,trim(p_data->>'name'),p_data->>'cls',v_addr,v_price,'',v_lat,v_lon,v_note);
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
  'delivery_lat',s.delivery_lat,'delivery_lon',s.delivery_lon,'delivery_note',s.delivery_note
 ) order by s.trip_date,s.dep_time,s.id) from public.signups s
 where s.phone=p_phone and s.trip_date>=(now()+interval '5 hours')::date),'[]'::jsonb));
end;
$mine$;
revoke all on function public.my_signups(text,text) from public,authenticated;
grant execute on function public.my_signups(text,text) to anon;

create or replace function public.cancel_signup(p_id uuid,p_phone text,p_pin text) returns jsonb
language plpgsql security definer set search_path='' as $cancel$
declare e text;n int;
begin
 if p_phone is null or p_pin is null then return jsonb_build_object('error','bad_pin');end if;
 e:=public.auth_pin(p_phone,p_pin,false);if e is not null then return jsonb_build_object('error',e);end if;
 delete from public.signups where id=p_id and phone=p_phone and tr='car' and now()<public.dl(trip_date,tr,dir,dep_time);
 get diagnostics n=row_count;if n=0 then return jsonb_build_object('error','locked_rec');end if;
 return jsonb_build_object('ok',true);
end;
$cancel$;
revoke all on function public.cancel_signup(uuid,text,text) from public,authenticated;
grant execute on function public.cancel_signup(uuid,text,text) to anon;

create or replace function public.organizer_signups(p_date date,p_dir text default null,p_tr text default null) returns jsonb
language plpgsql security definer set search_path='' as $organizer$
begin
 if auth.uid() is null or not exists(select 1 from public.organizers o where o.user_id=auth.uid()) then
  raise exception 'Organizer access required' using errcode='42501';end if;
 if p_date is null or (p_dir is not null and p_dir not in ('fri','sun')) or (p_tr is not null and p_tr<>'car') then
  raise exception 'Invalid list filters' using errcode='22023';end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',s.id,'date',s.trip_date,'dir',s.dir,'tr',s.tr,'time',s.dep_time,'name',s.name,'cls',s.cls,'phone',s.phone,'addr',s.addr,'price',s.price,
  'delivery_lat',s.delivery_lat,'delivery_lon',s.delivery_lon,'delivery_note',s.delivery_note
 ) order by s.dir,s.dep_time,s.cls,s.name,s.id) from public.signups s
 where s.trip_date=p_date and s.tr='car' and(p_dir is null or s.dir=p_dir)),'[]'::jsonb));
end;
$organizer$;
revoke all on function public.organizer_signups(date,text,text) from public,anon;
grant execute on function public.organizer_signups(date,text,text) to authenticated;
commit;
