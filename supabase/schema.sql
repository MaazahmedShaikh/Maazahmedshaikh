create extension if not exists pg_cron;

create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_hidden boolean default false,
  pin_hash text,
  disappear_seconds int default 60,
  burn_on_read boolean default true,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references threads(id) on delete cascade not null,
  sender_id uuid not null,
  content text not null,
  read_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter publication supabase_realtime add table threads, messages;

alter table threads enable row level security;
alter table messages enable row level security;

create policy "Strict 2-user threads access" on threads for all
  using (auth.uid() in ('0389abd2-3e56-4142-93d2-76a582f86642', '7003aff8-20e1-4c59-b194-46797fc3957e'))
  with check (auth.uid() in ('0389abd2-3e56-4142-93d2-76a582f86642', '7003aff8-20e1-4c59-b194-46797fc3957e'));

create policy "Strict 2-user messages access" on messages for all
  using (auth.uid() in ('0389abd2-3e56-4142-93d2-76a582f86642', '7003aff8-20e1-4c59-b194-46797fc3957e'))
  with check (auth.uid() in ('0389abd2-3e56-4142-93d2-76a582f86642', '7003aff8-20e1-4c59-b194-46797fc3957e'));

-- Server-side safety net: purge expired messages or unread messages older than 7 days every minute
select cron.schedule(
  'purge-expired-stealth-messages',
  '* * * * *',
  $$ delete from public.messages where expires_at <= now() or created_at < now() - interval '7 days'; $$
);

