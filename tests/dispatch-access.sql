-- Isolated test Supabase ONLY after migrations 0001..0006. Fictional data, rollback.
begin;
insert into auth.users(id,email) values('70000000-0000-4000-8000-000000000001','dispatch@example.invalid');
insert into public.organizers values('70000000-0000-4000-8000-000000000001');
insert into public.parents(phone,pin_hash) values('0000000007','unused-fictional-hash');
insert into public.signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price) values('0000000007','fri','car',current_date-1,'14:00','Учебный Ученик','7A','Учебная улица, дом А',6500);
set local role anon;
do $$ begin
 begin perform public.organizer_dispatch('read');raise exception 'Anon access allowed';exception when insufficient_privilege then null;end;
 begin perform * from public.drivers;raise exception 'Direct driver access allowed';exception when insufficient_privilege then null;end;
end;$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin perform public.organizer_dispatch('read');raise exception 'Non-organizer allowed';exception when insufficient_privilege then null;end;
end;$$;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
do $$ declare j jsonb;d uuid;g uuid;s uuid;v text;begin
 j:=public.organizer_dispatch('driver','{"name":"Учебный водитель","phone":"70000000007","kaspi":"70000000007"}');
 select (x->>'id')::uuid into d from jsonb_array_elements(j->'drivers') x where x->>'phone'='70000000007';
 -- Resolve record through the role-checked existing list endpoint.
 j:=public.organizer_signups(current_date-1,'fri','car');
 select (x->>'id')::uuid into s from jsonb_array_elements(j->'rows') x where x->>'phone'='0000000007';
 select x->>'updated_at' into v from jsonb_array_elements(j->'rows') x where (x->>'id')::uuid=s;
 j:=public.organizer_dispatch('group',jsonb_build_object('driver_id',d,'members',jsonb_build_array(jsonb_build_object('id',s,'version',v,'street','Учебная улица','lat',51.17,'lon',71.43,'verified',true))));
 select (x->>'id')::uuid into g from jsonb_array_elements(j->'groups') x where (x->>'driver_id')::uuid=d;
 j:=public.organizer_dispatch('publish',jsonb_build_object('id',g));
 if not exists(select 1 from jsonb_array_elements(j->'groups') x where (x->>'id')::uuid=g and (x->>'published')::boolean) then raise exception 'Publish failed';end if;
 j:=public.organizer_dispatch('cancel',jsonb_build_object('id',s,'version',v));
 if exists(select 1 from jsonb_array_elements(j->'groups') x where (x->>'id')::uuid=g and (x->>'published')::boolean) then raise exception 'Cancel did not invalidate';end if;
end;$$;
reset role;
rollback;
