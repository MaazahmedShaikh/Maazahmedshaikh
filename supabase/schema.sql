-- Create extensions
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Create threads table
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_hidden boolean default false,
  pin_hash text,
  disappear_seconds int default 60,
  burn_on_read boolean default true,
  created_at timestamptz default now()
);

-- Create messages table
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.threads(id) on delete cascade not null,
  sender_id uuid not null,
  content text not null,
  read_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Create push tokens table for cross-platform disguised push delivery
create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  expo_push_token text not null unique,
  platform text not null,
  active_thread_id uuid,
  active_until timestamptz,
  updated_at timestamptz default now()
);

-- Ensure active-chat suppression columns exist on already-provisioned tables
alter table public.user_push_tokens add column if not exists active_thread_id uuid;
alter table public.user_push_tokens add column if not exists active_until timestamptz;

-- Performance indexes to prevent full table scans & minimize Postgres RAM usage
create index if not exists idx_messages_thread_expires_created
  on public.messages (thread_id, expires_at, created_at desc);

create index if not exists idx_messages_expires_at
  on public.messages (expires_at);

create index if not exists idx_user_push_tokens_user_id
  on public.user_push_tokens (user_id);

-- Use DEFAULT replica identity (primary key only) so Postgres WAL & Realtime
-- do not buffer/serialize full TOASTed image payloads on every UPDATE or DELETE
alter table public.threads replica identity default;
alter table public.messages replica identity default;

-- Enable Realtime replication safely (ignore if already added)
do $$
begin
  alter publication supabase_realtime add table public.threads, public.messages;
exception
  when duplicate_object then null;
end $$;

-- Grant schema and table privileges to Supabase roles
grant usage on schema public to anon, authenticated;
grant all on table public.threads to anon, authenticated;
grant all on table public.messages to anon, authenticated;
grant all on table public.user_push_tokens to anon, authenticated;

-- Enable Row Level Security
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.user_push_tokens enable row level security;

-- Drop old policies if they exist
drop policy if exists "Strict 2-user threads access" on public.threads;
drop policy if exists "Strict 2-user messages access" on public.messages;
drop policy if exists "Strict 2-user push tokens access" on public.user_push_tokens;
drop policy if exists "Allow logged in users on threads" on public.threads;
drop policy if exists "Allow logged in users on messages" on public.messages;

-- Strict 2-user RLS locked exclusively to Maaz & Farnaz UUIDs
create policy "Strict 2-user threads access" on public.threads
  for all to authenticated
  using (auth.uid() in ('7003aff8-20e1-4c59-b194-46797fc3957e', '0389abd2-3e56-4142-93d2-76a582f86642'))
  with check (auth.uid() in ('7003aff8-20e1-4c59-b194-46797fc3957e', '0389abd2-3e56-4142-93d2-76a582f86642'));

create policy "Strict 2-user messages access" on public.messages
  for all to authenticated
  using (auth.uid() in ('7003aff8-20e1-4c59-b194-46797fc3957e', '0389abd2-3e56-4142-93d2-76a582f86642'))
  with check (auth.uid() in ('7003aff8-20e1-4c59-b194-46797fc3957e', '0389abd2-3e56-4142-93d2-76a582f86642'));

create policy "Strict 2-user push tokens access" on public.user_push_tokens
  for all to authenticated
  using (
    auth.uid() in ('7003aff8-20e1-4c59-b194-46797fc3957e', '0389abd2-3e56-4142-93d2-76a582f86642')
    and auth.uid() = user_id
  )
  with check (
    auth.uid() in ('7003aff8-20e1-4c59-b194-46797fc3957e', '0389abd2-3e56-4142-93d2-76a582f86642')
    and auth.uid() = user_id
  );

-- Server-side safety net: purge expired messages or unread messages older than 7 days every minute
do $$
begin
  perform cron.unschedule('purge-expired-stealth-messages');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.schedule(
    'purge-expired-stealth-messages',
    '* * * * *',
    $cron$
      delete from public.messages
      where id in (
        select id from public.messages
        where expires_at <= now() or created_at < now() - interval '7 days'
        limit 200
      );
    $cron$
  );
exception
  when others then null;
end $$;

-- Automatic zero-CLI remote disguised push trigger via pg_net (Expo Push + optional ntfy topic)
create or replace function public.dispatch_disguised_push()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $fn$
declare
  v_push_payload jsonb;
  v_ntfy_row record;
  v_picked_body text;
  v_tips text[] := array[
    'Tip: Rotate or tap +/- for quick sign conversion.',
    'Memory register cleared.',
    'Precision calculation engine ready.',
    'Daily calculation summary updated.'
  ];
begin
  v_picked_body := v_tips[1 + floor(random() * array_length(v_tips, 1))::int];

  -- 1. Send to native Expo Push devices (Android FCM / paid APNs)
  v_push_payload := (
    select jsonb_agg(
      case
        when t.platform = 'android' then
          jsonb_build_object(
            'to', t.expo_push_token,
            'title', 'SmartCalc',
            'body', v_picked_body,
            'sound', 'default',
            'priority', 'high',
            'channelId', 'smartcalc_tips'
          )
        else
          jsonb_build_object(
            'to', t.expo_push_token,
            'title', 'SmartCalc',
            'body', v_picked_body,
            'sound', 'default',
            'priority', 'high'
          )
      end
    )
    from public.user_push_tokens as t
    where t.user_id <> new.sender_id
      and t.platform <> 'ntfy'
      and not (
        t.active_thread_id = new.thread_id
        and t.active_until is not null
        and t.active_until > now()
      )
  );

  if v_push_payload is not null and jsonb_array_length(v_push_payload) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := v_push_payload
    );
  end if;

  -- 2. Send to optional private ntfy.sh topics (free closed-app iOS/Android notifications)
  for v_ntfy_row in
    select t.expo_push_token
    from public.user_push_tokens as t
    where t.user_id <> new.sender_id
      and t.platform = 'ntfy'
      and not (
        t.active_thread_id = new.thread_id
        and t.active_until is not null
        and t.active_until > now()
      )
  loop
    perform net.http_post(
      url := 'https://ntfy.sh',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'topic', v_ntfy_row.expo_push_token,
        'title', 'SmartCalc',
        'message', v_picked_body,
        'priority', 4
      )
    );
  end loop;

  return new;
exception
  when others then
    return new;
end;
$fn$;

drop trigger if exists tr_dispatch_disguised_push on public.messages;
create trigger tr_dispatch_disguised_push
  after insert on public.messages
  for each row
  execute function public.dispatch_disguised_push();
