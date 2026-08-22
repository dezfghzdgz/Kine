-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- "Nezajímá mě" a "Nedoporučovat kanál"
--
-- Divák může z nabídky ⋮ na kartě videa říct, že ho konkrétní video nebo
-- rovnou celý kanál nezajímá. Appka si to zapamatuje a přestane mu takový
-- obsah doporučovat.
--
-- Schované položky vidí a mění jen ten, komu patří - nikdo jiný se
-- nedozví, co si kdo schoval, a tvůrce se nedozví, kdo ho schoval.

create table if not exists hidden_videos (
  user_id uuid references profiles(id) on delete cascade not null,
  video_id uuid references videos(id) on delete cascade not null,
  hidden_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists hidden_channels (
  user_id uuid references profiles(id) on delete cascade not null,
  channel_id uuid references profiles(id) on delete cascade not null,
  hidden_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table hidden_videos enable row level security;
alter table hidden_channels enable row level security;

do $$ begin
  create policy "Schovaná videa vidí jen jejich majitel" on hidden_videos for select
  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Schovat video smí jen sám sobě" on hidden_videos for insert
  with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Vrátit schované video smí jen jeho majitel" on hidden_videos for delete
  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Schované kanály vidí jen jejich majitel" on hidden_channels for select
  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Schovat kanál smí jen sám sobě" on hidden_channels for insert
  with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Vrátit schovaný kanál smí jen jeho majitel" on hidden_channels for delete
  using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;


-- Uložení videa do playlistu podruhé.
--
-- Appka ukládá přes insert, takže druhé uložení stejného videa jen narazí na
-- duplicitu a nic se nestane - to je v pořádku. Kdyby ale někde v appce
-- zůstal upsert, databáze by ho brala jako úpravu existujícího řádku, na
-- kterou u playlist_videos nikdo povolení nemá, a uložení by spadlo.
-- Tohle pravidlo to dovolí majiteli playlistu.
do $$ begin
  create policy "Majitel playlistu smí upravit jeho položky" on playlist_videos for update
  using (exists (
    select 1 from playlists
    where playlists.id = playlist_videos.playlist_id and playlists.owner_id = auth.uid()
  ));
exception when duplicate_object then null; end $$;
