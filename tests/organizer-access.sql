-- Run ONLY in an isolated test Supabase after migrations 0001..0003.
-- All records below are fictional; changes are rolled back.
begin;
insert into auth.users(id, email) values
  ('10000000-0000-4000-8000-000000000001', 'organizer@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'ordinary@example.invalid');
insert into public.organizers(user_id) values ('10000000-0000-4000-8000-000000000001');
insert into public.parents(phone, pin_hash) values ('0000000001', 'fictional-unused-hash');
insert into public.signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price,poa) values
  ('0000000001','fri','car','2030-01-18','14:00','Учебный Ученик','7A','Учебная улица, дом А',5500,''),
  ('0000000001','sun','car','2030-01-18','16:00','Вымышленный Пассажир','8B','',0,'Да');

set local role anon;
do $$ begin
  begin
    perform public.organizer_signups('2030-01-18');
    raise exception 'FAIL: anon could execute organizer RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$ begin
  begin
    perform public.organizer_signups('2030-01-18');
    raise exception 'FAIL: ordinary user could read organizer list';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.organizers(user_id) values (auth.uid());
    raise exception 'FAIL: user could grant own organizer access';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.signups;
    raise exception 'FAIL: direct signup read allowed';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$ declare result jsonb; key_count int; begin
  result := public.organizer_signups('2030-01-18', 'fri', 'car');
  if jsonb_array_length(result->'rows') <> 1 then raise exception 'FAIL: filter/row count'; end if;
  if result->'rows'->0->>'addr' <> 'Учебная улица, дом А' then raise exception 'FAIL: wrong address'; end if;
  select count(*) into key_count from jsonb_object_keys(result->'rows'->0);
  if key_count <> 13 or (result->'rows'->0) ?| array['pin','pin_hash','locked_until'] then
    raise exception 'FAIL: unexpected columns';
  end if;
  if jsonb_array_length(public.organizer_signups('2030-01-19')->'rows') <> 0 then
    raise exception 'FAIL: empty list';
  end if;
  begin
    perform public.organizer_signups(null);
    raise exception 'FAIL: missing date accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
delete from public.organizers where user_id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform public.organizer_signups('2030-01-18');
    raise exception 'FAIL: revoked organizer could read list';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
