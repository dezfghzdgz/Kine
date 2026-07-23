-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table subscriptions (
  subscriber_id uuid references profiles(id) on delete cascade,
  channel_id uuid references profiles(id) on delete cascade,
  created_at timestamp with time zone default now(),
  primary key (subscriber_id, channel_id),
  check (subscriber_id <> channel_id)
);

alter table subscriptions enable row level security;

create policy "Odběry jsou veřejně viditelné" on subscriptions for select using (true);
create policy "Uživatel se odebírá jen sám za sebe" on subscriptions for insert with check (auth.uid() = subscriber_id);
create policy "Uživatel ruší jen svůj vlastní odběr" on subscriptions for delete using (auth.uid() = subscriber_id);
