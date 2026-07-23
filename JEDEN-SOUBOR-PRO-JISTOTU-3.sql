-- ============================================================
-- JEDEN SOUBOR PRO JISTOTU #3
-- Obsahuje všechno nové od minulého souhrnného souboru.
-- Bezpečné spustit i vícekrát - existující věci se přeskočí.
-- ============================================================

-- Dislajky komentářů
alter table comment_reactions add column if not exists type text default 'like' check (type in ('like', 'dislike'));

-- AI generovaný obsah
alter table videos add column if not exists is_ai_generated boolean default false;

-- Nahlašování obsahu
create table if not exists reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references profiles(id) on delete set null,
  video_id uuid references videos(id) on delete cascade,
  comment_id uuid references comments(id) on delete cascade,
  reason text not null,
  details text,
  status text default 'pending',
  created_at timestamp with time zone default now()
);
alter table reports enable row level security;
do $$ begin
  create policy "Uživatel nahlašuje jen sám za sebe" on reports for insert with check (auth.uid() = reporter_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel vidí jen svoje nahlášení" on reports for select using (auth.uid() = reporter_id);
exception when duplicate_object then null; end $$;

-- Chybějící pravidlo pro úpravu playlistů (přejmenování, barva)
do $$ begin
  create policy "Uživatel upravuje jen svoje playlisty" on playlists for update using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;

-- Ověřovací systém tvůrců (odznaky)
alter table profiles add column if not exists verification_tier text default 'none' check (verification_tier in ('none', 'basic', 'silver', 'blue'));
alter table profiles add column if not exists is_admin boolean default false;
create table if not exists verification_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  subscriber_count_at_request int,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamp with time zone default now(),
  reviewed_at timestamp with time zone
);
alter table verification_requests enable row level security;
do $$ begin
  create policy "Uživatel vidí jen svoje žádosti" on verification_requests for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel žádá jen sám za sebe" on verification_requests for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
alter table videos add column if not exists captions jsonb default '[]';

-- Ochrana citlivých polí profilu (is_admin, verification_tier) před úpravou z prohlížeče
create or replace function protect_admin_fields()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
    end if;
    if new.verification_tier is distinct from old.verification_tier then
      new.verification_tier := old.verification_tier;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;
drop trigger if exists trg_protect_admin_fields on profiles;
create trigger trg_protect_admin_fields
before update on profiles
for each row
execute function protect_admin_fields();

-- Playlisty: pořadí videí + vlastní náhledový obrázek
alter table playlist_videos add column if not exists position int default 0;
alter table playlists add column if not exists thumbnail_url text;
insert into storage.buckets (id, name, public)
values ('playlist-thumbnails', 'playlist-thumbnails', true)
on conflict (id) do nothing;
do $$ begin
  create policy "Náhledy playlistů jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'playlist-thumbnails');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává náhled jen do své složky" on storage.objects for insert
    with check (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj náhled playlistu" on storage.objects for update
    using (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
