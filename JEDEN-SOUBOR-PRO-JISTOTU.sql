-- ============================================================
-- JEDEN SOUBOR PRO JISTOTU
-- Spusť tenhle skript celý najednou v Supabase -> SQL Editor -> New Query -> Run
-- Je bezpečné ho spustit, i kdyby sis něco z toho už spustil dřív -
-- věci, co už existují, se jen přeskočí, nic se nerozbije.
-- ============================================================

-- Lajky komentářů
create table if not exists comment_reactions (
  comment_id uuid references comments(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamp with time zone default now(),
  primary key (comment_id, user_id)
);
alter table comment_reactions enable row level security;

do $$ begin
  create policy "Lajky komentářů jsou veřejně viditelné" on comment_reactions for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Přihlášený uživatel může lajkovat komentář" on comment_reactions for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen svůj lajk" on comment_reactions for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Odpovědi na komentáře
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;

-- Playlisty
create table if not exists playlists (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  created_at timestamp with time zone default now()
);
create table if not exists playlist_videos (
  playlist_id uuid references playlists(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  added_at timestamp with time zone default now(),
  primary key (playlist_id, video_id)
);
alter table playlists enable row level security;
alter table playlist_videos enable row level security;

do $$ begin
  create policy "Playlisty jsou veřejně viditelné" on playlists for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel vytváří jen svoje playlisty" on playlists for insert with check (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen svoje playlisty" on playlists for delete using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Obsah playlistů je veřejně viditelný" on playlist_videos for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přidává jen do svých playlistů" on playlist_videos for insert
    with check (exists (select 1 from playlists where playlists.id = playlist_id and playlists.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel odebírá jen ze svých playlistů" on playlist_videos for delete
    using (exists (select 1 from playlists where playlists.id = playlist_id and playlists.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- Podrobnosti videa (vhodné pro děti, plánování)
alter table videos add column if not exists made_for_kids boolean default false;
alter table videos add column if not exists scheduled_at timestamp with time zone;

-- Nahrávací průvodce (kategorie, jazyk, propagace, viditelnost, premiéra)
alter table videos add column if not exists category text;
alter table videos add column if not exists language text default 'cs';
alter table videos add column if not exists has_paid_promotion boolean default false;
alter table videos add column if not exists visibility text default 'public';
alter table videos add column if not exists is_premiere boolean default false;

-- Odběry
create table if not exists subscriptions (
  subscriber_id uuid references profiles(id) on delete cascade,
  channel_id uuid references profiles(id) on delete cascade,
  created_at timestamp with time zone default now(),
  primary key (subscriber_id, channel_id)
);
alter table subscriptions enable row level security;

do $$ begin
  create policy "Odběry jsou veřejně viditelné" on subscriptions for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel se odebírá jen sám za sebe" on subscriptions for insert with check (auth.uid() = subscriber_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel ruší jen svůj vlastní odběr" on subscriptions for delete using (auth.uid() = subscriber_id);
exception when duplicate_object then null; end $$;

-- Historie sledování
create table if not exists watch_history (
  user_id uuid references profiles(id) on delete cascade,
  video_id uuid references videos(id) on delete cascade,
  watched_at timestamp with time zone default now(),
  primary key (user_id, video_id)
);
alter table watch_history enable row level security;

do $$ begin
  create policy "Uživatel vidí jen svoji historii" on watch_history for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel zapisuje jen svoji historii" on watch_history for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel upravuje jen svoji historii" on watch_history for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen svoji historii" on watch_history for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Stažená videa
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

-- Úložiště pro profilové fotky
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$ begin
  create policy "Avatary jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'avatars');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává jen svůj avatar" on storage.objects for insert
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj avatar" on storage.objects for update
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen svůj avatar" on storage.objects for delete
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
