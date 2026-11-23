-- Create extension
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;

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

-- Enable Realtime replication safely (ignore if already added)
do $$
begin
  alter publication supabase_realtime add table public.threads, public.messages;
exception
  when duplicate_object then null;
end $$;

-- Enable Row Level Security
alter table public.threads enable row level security;
alter table public.messages enable row level security;

-- Drop old policies if they exist
drop policy if exists "Strict 2-user threads access" on public.threads;
drop policy if exists "Strict 2-user messages access" on public.messages;
drop policy if exists "Allow logged in users on threads" on public.threads;
drop policy if exists "Allow logged in users on messages" on public.messages;

-- Allow authenticated users (your private accounts) full access
create policy "Allow logged in users on threads" on public.threads
  for all to authenticated
  using (true)
  with check (true);

create policy "Allow logged in users on messages" on public.messages
  for all to authenticated
  using (true)
  with check (true);

-- Server-side safety net: purge expired messages or unread messages older than 7 days every minute
do $$
begin
  perform cron.schedule(
    'purge-expired-stealth-messages',
    '* * * * *',
    $$ delete from public.messages where expires_at <= now() or created_at < now() - interval '7 days'; $$
  );
exception
  when others then null;
end $$;
