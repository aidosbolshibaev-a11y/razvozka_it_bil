# Развозка Burabay IT BIL

Запись детей на развозку Щучинск ↔ Астана (машина / электричка). Родители записываются без регистрации: телефон + PIN из 4 цифр.

## Структура
- `public/` — сайт (статика, без сборки): `index.html`, `config.js`
- `supabase/migrations/0001_init.sql` — таблицы, RLS, RPC-функции, проверка дедлайнов и цен на сервере
- `supabase/migrations/0002_cleanup.sql` — временное хранение: функция `cleanup_old()` и ежедневная очистка (02:00 по Астане)
- `supabase/functions/send-lists/` — Edge Function: по дедлайну отправляет списки в WhatsApp
- `.github/workflows/keepalive.yml` — ежедневный пинг, чтобы бесплатный проект Supabase не засыпал

## Запуск
1. **Supabase:** создайте проект → включите расширения `pg_cron` и `pg_net` (Database → Extensions) → SQL Editor → выполните `0001_init.sql`, затем `0002_cleanup.sql`.
2. **Фронт:** в `public/config.js` впишите Project URL и anon-ключ (Project Settings → API).
3. **Хостинг:** Cloudflare Pages (или Netlify/Vercel) → подключить этот репозиторий, build command пустой, output directory `public`.
4. **WhatsApp:** задайте секреты функции и задеплойте её:
   ```
   supabase secrets set CRON_SECRET=<длинная-строка> GREEN_ID=<id> GREEN_TOKEN=<token> WA_CHAT_ID=<77001234567@c.us или id группы@g.us>
   supabase functions deploy send-lists --no-verify-jwt
   ```
5. **Расписание:** включите расширения `pg_cron` и `pg_net` (Database → Extensions), затем в SQL Editor:
   ```sql
   select cron.schedule('send-lists','*/15 * * * *',$$
     select net.http_post(
       url:='https://<project-ref>.supabase.co/functions/v1/send-lists',
       headers:='{"x-cron-secret":"<CRON_SECRET>"}'::jsonb) $$);
   ```
6. **Keepalive:** в GitHub → Settings → Secrets → Actions добавьте `SUPABASE_URL` и `SUPABASE_ANON_KEY`.

## Что менять при настройке
- Названия общих точек: `POINTS`, `PTL` в `public/index.html` **и** список `('Точка 1','Точка 2')` в `upsert_signup` (SQL).
- Цены: `PRICE` в `index.html` **и** значения 5500 / 6500 в `upsert_signup`.
- Расписание рейсов: `SLOTS` в `index.html` **и** массивы времени в `upsert_signup`; дедлайны — функция `dl()` и `deadline()` в Edge Function.
- WhatsApp-провайдер: функция `sendWhatsApp` в Edge Function (сверьте формат запроса с документацией выбранного провайдера).

## Хранение данных
Данные временные: на следующий день после поездки удаляются записи, затем телефоны и PIN-хэши родителей без активных записей, а отметки об отправленных списках — через 30 дней. Ручной запуск: `select cleanup_old();`. Проверить расписание: `select * from cron.job;`.

## Известные ограничения
- Организаторского интерфейса нет: списки уходят в WhatsApp автоматически; сырые данные смотрите в Supabase → Table Editor (таблицы `signups`, `sent_lists`).
- PIN защищает от случайного доступа (5 неверных попыток → блок на 15 минут), но телефон + PIN — не полноценная аутентификация. Кто первым записал ребёнка на номер, тот и задал PIN этого номера.
- Персональные данные детей и родителей: проверьте требования законодательства РК к месту хранения до запуска.
