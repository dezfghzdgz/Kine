-- ============================================================
-- JEDEN SOUBOR PRO JISTOTU #2
-- Obsahuje všechno nové od posledního souhrnného souboru.
-- Bezpečné spustit i vícekrát - existující věci se přeskočí.
-- ============================================================

-- KRITICKÁ OPRAVA SOUKROMÍ - nahrazuje staré, nebezpečné pravidlo
drop policy if exists "Videa jsou veřejně viditelná" on videos;

do $$ begin
  create policy "Videa jsou viditelná podle nastavení soukromí" on videos for select
  using (
    visibility = 'public'
    or owner_id = auth.uid()
    or (
      visibility = 'subscribers'
      and exists (
        select 1 from subscriptions
        where subscriptions.channel_id = videos.owner_id
        and subscriptions.subscriber_id = auth.uid()
      )
    )
  );
exception when duplicate_object then null; end $$;

-- Historie zhlédnutí v čase (pro grafy)
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

-- Systém hodnocení (hvězdičky / lajk-dislike)
alter table profiles add column if not exists rating_mode text check (rating_mode in ('stars', 'like_dislike'));
alter table video_reactions add column if not exists score int check (score between 1 and 5);
update video_reactions set score = 5 where reaction = 'like' and score is null;
update video_reactions set score = 1 where reaction = 'dislike' and score is null;

-- Časované komentáře (Scene)
alter table comments add column if not exists timestamp_seconds int;

-- Vlastní náhledové obrázky
alter table videos add column if not exists custom_thumbnail boolean default false;
insert into storage.buckets (id, name, public) values ('thumbnails', 'thumbnails', true) on conflict (id) do nothing;
do $$ begin
  create policy "Náhledy jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'thumbnails');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává náhled jen do své složky" on storage.objects for insert
    with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj náhled" on storage.objects for update
    using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

-- Notifikace
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
  create policy "Kdokoliv přihlášený může vytvořit notifikaci pro jiného uživatele" on notifications for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel upravuje jen svoje notifikace" on notifications for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Vzhled kanálu (banner, popis, odkazy)
alter table profiles add column if not exists banner_url text;
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists social_links jsonb default '[]';
insert into storage.buckets (id, name, public) values ('banners', 'banners', true) on conflict (id) do nothing;
do $$ begin
  create policy "Bannery jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'banners');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává jen svůj banner" on storage.objects for insert
    with check (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj banner" on storage.objects for update
    using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
