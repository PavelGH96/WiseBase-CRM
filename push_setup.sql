-- ============================================================
-- WiseBase CRM — настройка push-уведомлений (ШАГ 1)
-- Где выполнить: Supabase Dashboard → SQL Editor → New query →
-- вставить всё целиком → Run
-- ============================================================

-- Таблица подписок на push (одна строка = одно устройство пользователя)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Каждый пользователь управляет только своими подписками
create policy "push_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "push_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id);
create policy "push_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ============================================================
-- РАСПИСАНИЕ РАССЫЛКИ (ШАГ 4 — выполнять ПОСЛЕ деплоя Edge Function!)
-- Перед запуском замените SERVICE_ROLE_KEY на ваш ключ:
-- Dashboard → Project Settings → API → service_role (secret)
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Каждый день в 03:00 UTC = 08:00 по Екатеринбургу
select cron.schedule(
  'wisebase-send-push-morning',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://umgvbcmxbevbmyzhdsmr.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Дополнительно (по желанию): второе напоминание в 14:00 по Екатеринбургу
-- select cron.schedule(
--   'wisebase-send-push-day',
--   '0 9 * * *',
--   $$
--   select net.http_post(
--     url := 'https://umgvbcmxbevbmyzhdsmr.supabase.co/functions/v1/send-push',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer SERVICE_ROLE_KEY'),
--     body := '{}'::jsonb
--   );
--   $$
-- );

-- Посмотреть активные задания:  select * from cron.job;
-- Удалить задание:               select cron.unschedule('wisebase-send-push-morning');
