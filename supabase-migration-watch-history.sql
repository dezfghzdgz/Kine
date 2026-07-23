-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table watch_history (
  user_id uuid references profiles(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  watched_at timestamp with time zone default now(),
  primary key (user_id, video_id)
);

alter table watch_history enable row level security;

create policy "Uživatel vidí jen svoji historii" on watch_history for select using (auth.uid() = user_id);
create policy "Uživatel zapisuje jen svoji historii" on watch_history for insert with check (auth.uid() = user_id);
create policy "Uživatel upravuje jen svoji historii" on watch_history for update using (auth.uid() = user_id);
create policy "Uživatel maže jen svoji historii" on watch_history for delete using (auth.uid() = user_id);
