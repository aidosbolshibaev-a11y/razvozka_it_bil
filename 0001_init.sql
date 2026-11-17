-- Развозка Burabay IT BIL: схема, правила доступа, RPC-функции.
-- Выполнить целиком в Supabase -> SQL Editor.
-- Прямого доступа к таблицам у браузера нет (RLS без политик): всё идёт через RPC ниже.
create extension if not exists pgcrypto with schema extensions;

create table if not exists parents(
  phone text primary key,                 -- 10 цифр без +7
  pin_hash text not null,
  fails int not null default 0,
  locked_until timestamptz);

create table if not exists signups(
  id uuid primary key default gen_random_uuid(),
  phone text not null references parents(phone),
  dir text not null check (dir in ('fri','sun')),   -- fri: Щучинск->Астана, sun: Астана->Щучинск
  tr text not null check (tr in ('car','train')),
  trip_date date not null,
  dep_time text not null,
  name text not null,
  cls text not null,
  addr text not null default '',
  price int not null default 0,
  poa text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
create index if not exists signups_phone_idx on signups(phone);
create index if not exists signups_date_idx on signups(trip_date);

create table if not exists sent_lists(key text primary key, sent_at timestamptz not null default now());

alter table parents enable row level security;
alter table signups enable row level security;
alter table sent_lists enable row level security;
revoke all on parents, signups, sent_lists from anon, authenticated;

-- Дедлайн записи (время Астаны = UTC+5).
-- Машина: за 24 ч до выезда. Электричка: за 2 дня (dir=fri) или за 3 дня (dir=sun) до даты, 18:00.
create or replace function dl(p_date date,p_tr text,p_dir text,p_time text) returns timestamptz
language sql immutable as $$
  select case when p_tr='car'
    then (((p_date+p_time::time)-interval '24 hours')-interval '5 hours') at time zone 'UTC'
    else (((p_date-(case when p_dir='fri' then 2 else 3 end))+time '18:00')-interval '5 hours') at time zone 'UTC' end $$;

-- Проверка телефона + PIN. Возвращает код ошибки или null. После 5 неверных попыток блок на 15 минут.
create or replace function auth_pin(p_phone text,p_pin text,p_create boolean) returns text
language plpgsql security definer set search_path=public,extensions as $$
declare r parents;
begin
  if p_phone !~ '^\d{10}$' then return 'bad_phone'; end if;
  if p_pin !~ '^\d{4}$' then return 'bad_pin'; end if;
  select * into r from parents where phone=p_phone for update;
  if not found then
    if not p_create then return 'pin_wrong'; end if;
    insert into parents(phone,pin_hash) values(p_phone,crypt(p_pin,gen_salt('bf')));
    return null;
  end if;
  if r.locked_until is not null and r.locked_until>now() then return 'locked'; end if;
  if r.pin_hash=crypt(p_pin,r.pin_hash) then
    update parents set fails=0,locked_until=null where phone=p_phone;
    return null;
  end if;
  update parents set
    locked_until=case when r.fails+1>=5 then now()+interval '15 minutes' end,
    fails=case when r.fails+1>=5 then 0 else r.fails+1 end
  where phone=p_phone;
  return 'pin_wrong';
end $$;
revoke execute on function auth_pin(text,text,boolean) from public, anon, authenticated;

-- Создание/изменение записи. Цена и расписание проверяются на сервере.
-- ВАЖНО: список общих точек и цены (5500 / 6500) заданы здесь; при смене названий точек обновить функцию.
create or replace function upsert_signup(p_id uuid,p_phone text,p_pin text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare e text; d date; old signups;
  v_tr text:=p_data->>'tr'; v_dir text:=p_data->>'dir'; v_time text:=p_data->>'time';
  v_addr text:=trim(coalesce(p_data->>'addr','')); v_poa text:=coalesce(p_data->>'poa',''); v_price int:=0;
begin
  e:=auth_pin(p_phone,p_pin,true);
  if e is not null then return jsonb_build_object('error',e); end if;
  begin d:=(p_data->>'date')::date; exception when others then return jsonb_build_object('error','bad_data'); end;
  if v_dir not in ('fri','sun') or v_tr not in ('car','train')
     or length(trim(coalesce(p_data->>'name','')))<5
     or coalesce(p_data->>'cls','') !~ '^(7|8|9|10|11)[A-E]$' then
    return jsonb_build_object('error','bad_data'); end if;
  if not (v_time = any (case when v_tr='car' then array['14:00','16:00']
                             when v_dir='fri' then array['14:20','15:35'] else array['10:10'] end)) then
    return jsonb_build_object('error','bad_data'); end if;
  if v_tr='car' then
    v_poa:='';
    if v_addr in ('Точка 1','Точка 2') then v_price:=5500;
    elsif length(v_addr)>=5 then v_price:=6500;
    else return jsonb_build_object('error','addr'); end if;
  else
    v_addr:='';
    if v_poa not in ('Да','Нет') then return jsonb_build_object('error','poa'); end if;
  end if;
  if now()>=dl(d,v_tr,v_dir,v_time) then return jsonb_build_object('error','closed'); end if;
  if p_id is not null then
    select * into old from signups where id=p_id and phone=p_phone;
    if not found or now()>=dl(old.trip_date,old.tr,old.dir,old.dep_time) then
      return jsonb_build_object('error','locked_rec'); end if;
    update signups set dir=v_dir,tr=v_tr,trip_date=d,dep_time=v_time,name=trim(p_data->>'name'),
      cls=p_data->>'cls',addr=v_addr,price=v_price,poa=v_poa,updated_at=now() where id=p_id;
  else
    insert into signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price,poa)
    values(p_phone,v_dir,v_tr,d,v_time,trim(p_data->>'name'),p_data->>'cls',v_addr,v_price,v_poa);
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function my_signups(p_phone text,p_pin text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare e text;
begin
  e:=auth_pin(p_phone,p_pin,false);
  if e is not null then return jsonb_build_object('error',e); end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'dir',dir,'tr',tr,'date',trip_date,'time',dep_time,'name',name,'cls',cls,'addr',addr,'price',price,'poa',poa)
    order by trip_date,dep_time) from signups
    where phone=p_phone and trip_date>=(now()+interval '5 hours')::date),'[]'::jsonb));
end $$;

create or replace function cancel_signup(p_id uuid,p_phone text,p_pin text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare e text; n int;
begin
  e:=auth_pin(p_phone,p_pin,false);
  if e is not null then return jsonb_build_object('error',e); end if;
  delete from signups where id=p_id and phone=p_phone and now()<dl(trip_date,tr,dir,dep_time);
  get diagnostics n=row_count;
  if n=0 then return jsonb_build_object('error','locked_rec'); end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function ping() returns int language sql as $$ select 1 $$;

grant execute on function upsert_signup(uuid,text,text,jsonb), my_signups(text,text),
  cancel_signup(uuid,text,text), ping() to anon;
