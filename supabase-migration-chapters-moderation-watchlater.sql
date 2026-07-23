-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

-- Kapitoly videa (nastavuje tvůrce předem)
alter table videos add column if not exists chapters jsonb default '[]';

-- Připnutí komentáře
alter table comments add column if not exists pinned boolean default false;

-- Tvůrce může smazat i cizí komentář na svém videu
do $$ begin
  create policy "Vlastník videa může smazat kterýkoliv komentář na svém videu"
  on comments for delete
  using (exists (select 1 from videos where videos.id = comments.video_id and videos.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Vlastník videa může připnout komentář na svém videu"
  on comments for update
  using (exists (select 1 from videos where videos.id = comments.video_id and videos.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- Sledovat později
create table if not exists watch_later (
  user_id uuid references profiles(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  added_at timestamp with time zone default now(),
  primary key (user_id, video_id)
);
alter table watch_later enable row level security;

do $$ begin
  create policy "Uživatel vidí jen svůj seznam Sledovat později" on watch_later for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přidává jen do svého seznamu" on watch_later for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen ze svého seznamu" on watch_later for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
