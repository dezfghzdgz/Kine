-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table if not exists downloads (
  user_id uuid references profiles(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  downloaded_at timestamp with time zone default now(),
  primary key (user_id, video_id)
);

alter table downloads enable row level security;

do $$ begin
  create policy "Uživatel vidí jen svoje stažené" on downloads for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Uživatel zapisuje jen svoje stažené" on downloads for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Uživatel maže jen svoje stažené" on downloads for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
