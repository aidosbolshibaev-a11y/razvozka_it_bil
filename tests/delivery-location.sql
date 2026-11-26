-- Test Supabase only, after migrations 0001..0004. Fictional data, rolled back.
begin;
do $test$
declare result jsonb;stored public.signups;
begin
 result:=public.upsert_signup(null,'0000000001','1234',jsonb_build_object('tr','train'));
 if result->>'error'<>'car_only' then raise exception 'Train accepted';end if;
 result:=public.upsert_signup(null,'0000000001','1234',jsonb_build_object('tr','car','dir','fri','date',current_date+14,'time','14:00','name','Учебный Ученик','cls','7A','addr','FORGED','delivery_lat',51.17,'delivery_lon',71.43,'price',0));
 if result->>'ok'<>'true' then raise exception 'Valid location rejected: %',result;end if;
 select * into stored from public.signups where phone='0000000001' and delivery_lat=51.17;
 if stored.delivery_lon<>71.43 or stored.price<>6500 or stored.addr='FORGED' then raise exception 'Coordinates/price not persisted correctly';end if;
 result:=public.upsert_signup(null,'0000000001','1234',jsonb_build_object('tr','car','dir','fri','date',current_date+14,'time','14:00','name','Учебный Ученик','cls','7A','delivery_lat',0,'delivery_lon',0));
 if result->>'error'<>'bad_location' then raise exception 'Outside area accepted';end if;
 result:=public.upsert_signup(null,'0000000001','1234',jsonb_build_object('tr','car','dir','fri','date',current_date+14,'time','14:00','name','Учебный Ученик','cls','7A','delivery_lat',51.17));
 if result->>'error'<>'bad_location' then raise exception 'Partial coordinates accepted';end if;
 result:=public.upsert_signup(null,'0000000001','1234',jsonb_build_object('tr','car','dir','fri','date',current_date+14,'time','14:00','name','Учебный Ученик','cls','7A','addr','Точка 1','price',1));
 if result->>'ok'<>'true' then raise exception 'Common point rejected';end if;
 begin
  insert into public.signups(phone,tr,dir,trip_date,dep_time,name,cls)values('0000000001','train','fri',current_date+14,'14:00','Учебный Ученик','7A');
  raise exception 'Direct train write accepted';
 exception when check_violation then null;end;
end;
$test$;
rollback;
