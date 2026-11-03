-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  message text not null,
  link text,
  read boolean default false,
  created_at timestamp with time zone default now()
);

alter table notifications enable row level security;

do $$ begin
  create policy "Uživatel vidí jen svoje notifikace" on notifications for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  -- POZOR (bezpečnost): dřív "with check (true)" pustilo i nepřihlášeného.
  -- Odesílatele a druh hlídá trigger notifications_client_guard
  -- (supabase-migration-bezpecnost-rijen.sql / -bezpecnost-listopad.sql);
  -- tady aspoň vyžadujeme přihlášení, kdyby se soubor pustil znovu.
  create policy "Kdokoliv přihlášený může vytvořit notifikaci pro jiného uživatele" on notifications for insert with check (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel upravuje jen svoje notifikace" on notifications for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
