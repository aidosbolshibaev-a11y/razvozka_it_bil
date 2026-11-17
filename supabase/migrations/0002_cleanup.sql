-- Временное хранение: данные удаляются на следующий день после поездки.
-- Выполнить в Supabase -> SQL Editor после 0001_init.sql.
create or replace function cleanup_old() returns jsonb
language plpgsql security definer set search_path=public as $$
declare a int; b int; c int;
begin
  -- записи с датой поездки раньше «сегодня» (по Астане, UTC+5)
  delete from signups where trip_date < (now()+interval '5 hours')::date;
  get diagnostics a=row_count;
  -- служебные отметки об отправленных списках (после удаления записей повторной отправки быть не может)
  delete from sent_lists where sent_at < now()-interval '30 days';
  get diagnostics b=row_count;
  -- телефоны и PIN-хэши родителей, у которых не осталось записей
  delete from parents p where not exists (select 1 from signups s where s.phone=p.phone);
  get diagnostics c=row_count;
  return jsonb_build_object('signups',a,'sent_lists',b,'parents',c);
end $$;
revoke execute on function cleanup_old() from public, anon, authenticated;

-- Ежедневно в 02:00 по Астане (21:00 UTC). Нужно включённое расширение pg_cron.
do $$ begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('cleanup-old','0 21 * * *','select cleanup_old()');
  else
    raise notice 'pg_cron не включён: включите расширение и выполните select cron.schedule(''cleanup-old'',''0 21 * * *'',''select cleanup_old()'');';
  end if;
end $$;
