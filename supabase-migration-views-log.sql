-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table if not exists views_log (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references videos(id) on delete cascade not null,
  viewed_at timestamp with time zone default now()
);

alter table views_log enable row level security;

do $$ begin
  create policy "Views log je veřejně čitelný" on views_log for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Kdokoliv může zapsat zhlédnutí" on views_log for insert with check (true);
exception when duplicate_object then null; end $$;
