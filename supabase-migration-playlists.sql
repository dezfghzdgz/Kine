-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Přidává playlisty.

create table playlists (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  created_at timestamp with time zone default now()
);

create table playlist_videos (
  playlist_id uuid references playlists(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  added_at timestamp with time zone default now(),
  primary key (playlist_id, video_id)
);

alter table playlists enable row level security;
alter table playlist_videos enable row level security;

create policy "Playlisty jsou veřejně viditelné" on playlists for select using (true);
create policy "Uživatel vytváří jen svoje playlisty" on playlists for insert with check (auth.uid() = owner_id);
create policy "Uživatel maže jen svoje playlisty" on playlists for delete using (auth.uid() = owner_id);

create policy "Obsah playlistů je veřejně viditelný" on playlist_videos for select using (true);
create policy "Uživatel přidává jen do svých playlistů" on playlist_videos for insert
  with check (exists (select 1 from playlists where playlists.id = playlist_id and playlists.owner_id = auth.uid()));
create policy "Uživatel odebírá jen ze svých playlistů" on playlist_videos for delete
  using (exists (select 1 from playlists where playlists.id = playlist_id and playlists.owner_id = auth.uid()));
