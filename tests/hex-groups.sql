-- Isolated Supabase test database ONLY after 0001..0008. Fictional data; rollback.
begin;
insert into auth.users(id,email) values('80000000-0000-4000-8000-000000000001','hex-organizer@example.invalid');
insert into public.organizers(user_id) values('80000000-0000-4000-8000-000000000001');
insert into public.parents(phone,pin_hash) values('0000000008','fictional-unused');
insert into public.signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price,delivery_lat,delivery_lon)
 select '0000000008','fri','car',current_date-2,'14:00','Учебный Ученик '||n,'7A','Учебная точка',6500,51.16+n*0.00001,71.43 from generate_series(1,8)n;
insert into public.signups(phone,dir,tr,trip_date,dep_time,name,cls,addr,price)
 values('0000000008','fri','car',current_date-2,'14:00','Вымышленный без точки','7A','Не уточнено',5500);
set local role anon;
do $$ begin
 begin perform public.organizer_dispatch('auto_group','{}');raise exception 'Anon allowed';exception when insufficient_privilege then null;end;
 begin perform public.organizer_dispatch_v1('read','{}');raise exception 'Private bypass allowed';exception when insufficient_privilege then null;end;
end;$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
do $$ declare j jsonb;gid uuid;begin
 j:=public.organizer_dispatch('auto_group',jsonb_build_object('date',current_date-2,'dir','fri','time','14:00'));
 if (j->'auto_result'->>'groups')::int<>2 or (j->'auto_result'->>'records')::int<>8 or jsonb_array_length(j->'auto_result'->'missing')<>1 then raise exception 'Counts failed: %',j;end if;
 select (g->>'id')::uuid into gid from jsonb_array_elements(j->'groups')g where g->>'trip_date'=(current_date-2)::text limit 1;
 begin perform public.organizer_dispatch('publish',jsonb_build_object('id',gid));raise exception 'FAIL: unassigned driver published';exception when raise_exception then if sqlerrm like 'FAIL:%' then raise;end if;end;
 j:=public.organizer_dispatch('auto_group',jsonb_build_object('date',current_date-2,'dir','fri','time','14:00'));
 if (j->'auto_result'->>'groups')::int<>0 or (j->'auto_result'->>'records')::int<>0 then raise exception 'Repeat duplicated groups';end if;
end;$$;
reset role;
do $$ declare a int[];b int[];begin
 if public.hex_cell(null,71.43) is not null or public.hex_cell(0,0) is not null then raise exception 'Bad coordinate accepted';end if;
 a:=public.hex_cell(51.16,71.43);if a<>array[0,0] then raise exception 'Wrong origin';end if;
 -- Opposite sides of a cell edge must be adjacent, not treated as distant addresses.
 a:=public.hex_cell(51.16,71.433721);b:=public.hex_cell(51.16,71.433723);
 if greatest(abs(a[1]-b[1]),abs(a[2]-b[2]),abs(a[1]+a[2]-b[1]-b[2]))>1 then raise exception 'Boundary neighbors lost';end if;
 if exists(select 1 from public.delivery_groups g join public.group_members m on m.group_id=g.id group by g.id having count(*)>7) then raise exception 'Over capacity';end if;
 if (select count(*) from public.group_members m join public.signups s on s.id=m.signup_id where s.phone='0000000008')<>8 then raise exception 'Lost members';end if;
end;$$;
rollback;
