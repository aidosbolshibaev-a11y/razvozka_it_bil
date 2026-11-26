-- ONLY in isolated test Supabase after 0001..0005. Fictional data; rollback.
begin;
insert into auth.users(id,email) values
 ('60000000-0000-4000-8000-000000000001','catalog-organizer@example.invalid'),
 ('60000000-0000-4000-8000-000000000002','catalog-parent@example.invalid');
insert into public.organizers(user_id) values('60000000-0000-4000-8000-000000000001');
set local role anon;
do $t$ begin
 perform public.trip_catalog();
 begin perform public.organizer_add_point('astana','Учебная улица, дом А');raise exception 'Anon write accepted';exception when insufficient_privilege then null;end;
 begin perform public.organizer_add_time('fri','18:35');raise exception 'Anon time accepted';exception when insufficient_privilege then null;end;
end;$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000002',true);
do $t$ begin
 begin perform public.organizer_add_point('astana','Учебная улица, дом А');raise exception 'Non-organizer write accepted';exception when insufficient_privilege then null;end;
 begin perform public.organizer_add_time('fri','18:35');raise exception 'Non-organizer time accepted';exception when insufficient_privilege then null;end;
 begin insert into public.departure_times values('fri','19:35');raise exception 'Direct write accepted';exception when insufficient_privilege then null;end;
end;$t$;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000001',true);
do $t$ declare j jsonb;begin
 j:=public.organizer_add_point('astana','Учебная улица, дом А');if j->>'ok' is distinct from 'true' then raise exception 'Add failed %',j;end if;
 j:=public.organizer_add_point('astana','Учебная улица, дом А');if j->>'error' is distinct from 'duplicate' then raise exception 'Duplicate accepted';end if;
 j:=public.organizer_add_time('fri','18:35');if j->>'ok' is distinct from 'true' then raise exception 'Time failed';end if;
 begin perform public.organizer_add_time('fri','25:99');raise exception 'Bad time accepted';exception when invalid_parameter_value then null;end;
end;$t$;
reset role;
do $t$
declare j jsonb;point uuid;payload jsonb;saved public.signups;
begin
 select id into point from public.common_points where city='astana' and address='Учебная улица, дом А';
 payload:=jsonb_build_object('tr','car','dir','fri','from_city','shchuchinsk','to_city','astana','date',current_date+14,'time','18:35','name','Учебный Ученик','cls','7A','point_id',point,'price',1,'addr','FORGED','delivery_lat',0);
 j:=public.upsert_signup(null,'0000000006','1234',payload);if j->>'ok' is distinct from 'true' then raise exception 'Valid signup failed %',j;end if;
 select * into strict saved from public.signups where phone='0000000006';
 if saved.price<>5500 or saved.addr<>'Учебная улица, дом А' or saved.delivery_lat is not null then raise exception 'Canonical point not used';end if;
 j:=public.upsert_signup(null,'0000000006','1234',payload||'{"from_city":"astana"}');if j->>'error' is distinct from 'bad_cities' then raise exception 'Equal cities accepted';end if;
 j:=public.upsert_signup(null,'0000000006','1234',payload||'{"dir":"sun","from_city":"astana","to_city":"shchuchinsk","time":"14:00"}');if j->>'error' is distinct from 'addr' then raise exception 'Other city point accepted';end if;
 j:=public.upsert_signup(null,'0000000006','1234',payload||'{"time":"03:17"}');if j->>'error' is distinct from 'bad_data' then raise exception 'Unknown time accepted';end if;
 j:=public.upsert_signup(saved.id,'0000000006','1234',payload||'{"name":"Вымышленный Ученик"}');if j->>'ok' is distinct from 'true' then raise exception 'Edit failed';end if;
end;$t$;
rollback;
