-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- CHAT JAKO NA TWITCHI A KICKU (říjen 2026)
--
--   1. Zprávy: odpovědi na zprávu, odznaky (vysílající, moderátor, tým Kine,
--      ověřený, odběratel), barva jména, /me, "poprvé v chatu" - sloupec meta.
--   2. Pravidla chatu: režim "jen emoty" a připnutá zpráva.
--   3. Barva jména v chatu (každý si ji může zvolit).
--   4. Emoty kanálu: tvůrce si nahraje vlastní (do 50), píšou se kódem.
--
-- Dá se pustit opakovaně. Web funguje i bez ní - chat jede dál, jen bez
-- těchhle novinek (emoji a emoty Kine fungují i bez ní).
-- Na konci vypíše tabulku s tím, co udělal.

drop table if exists _migrace_zprava;
create temp table _migrace_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 1. Zprávy v chatu: odpověď a údaje ke zprávě
-- =====================================================================
do $mig$
begin
  if to_regclass('public.live_chat_messages') is null then
    insert into _migrace_zprava (co, vysledek) values ('live_chat_messages', 'tabulka neexistuje (spust supabase-migration-zive-vysilani.sql), preskoceno');
    return;
  end if;
  -- Na kterou zprávu odpovídá (kopie textu je i v meta - smazaná původní zpráva nevadí).
  execute 'alter table live_chat_messages add column if not exists reply_to bigint';
  -- Odznaky, barva jména, /me, první zpráva, odpověď (lib/chatEmotes.ts - ChatMeta). Zapisuje jen server.
  execute 'alter table live_chat_messages add column if not exists meta jsonb';
  execute 'alter table live_chat_messages drop constraint if exists live_chat_messages_meta_size';
  execute 'alter table live_chat_messages add constraint live_chat_messages_meta_size check (meta is null or pg_column_size(meta) < 2048)';
  insert into _migrace_zprava (co, vysledek) values ('chat: odpovedi, odznaky, barva jmena (meta)', 'hotovo');
end $mig$;


-- =====================================================================
-- 2. Pravidla chatu: jen emoty, připnutá zpráva
-- =====================================================================
do $mig$
begin
  if to_regclass('public.live_chat_settings') is null then
    insert into _migrace_zprava (co, vysledek) values ('live_chat_settings', 'tabulka neexistuje (spust supabase-migration-zive-2.sql), preskoceno');
    return;
  end if;
  execute 'alter table live_chat_settings add column if not exists emote_only boolean not null default false';
  -- Kopie připnuté zprávy: { id, uid, u, t, at }.
  execute 'alter table live_chat_settings add column if not exists pinned jsonb';
  insert into _migrace_zprava (co, vysledek) values ('chat: rezim jen emoty, pripnuta zprava', 'hotovo');
end $mig$;


-- =====================================================================
-- 3. Barva jména v chatu
-- =====================================================================
alter table profiles add column if not exists chat_color text;
alter table profiles drop constraint if exists profiles_chat_color_check;
alter table profiles add constraint profiles_chat_color_check check (chat_color is null or chat_color ~ '^#[0-9a-f]{6}$');
insert into _migrace_zprava (co, vysledek) values ('chat: barva jmena (profiles.chat_color)', 'hotovo');


-- =====================================================================
-- 4. Emoty kanálu
-- =====================================================================
-- Číst smí kdokoliv (chat je potřebuje k vykreslení zpráv); přidávat a mazat
-- jen přes server (/api/live/chat/emotes) - ten hlídá majitele kanálu,
-- formát a velikost obrázku a obsah (kontrola nahoty).
create table if not exists channel_emotes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references profiles(id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_]{1,23}$'),
  image_url text not null check (char_length(image_url) <= 500),
  animated boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists channel_emotes_code_idx on channel_emotes (channel_id, lower(code));
create index if not exists channel_emotes_channel_idx on channel_emotes (channel_id, created_at);
alter table channel_emotes enable row level security;
do $$ begin
  create policy "Emoty kanálů jsou veřejné" on channel_emotes for select using (true);
exception when duplicate_object then null; end $$;
insert into _migrace_zprava (co, vysledek) values ('emoty kanalu (channel_emotes)', 'hotovo');


-- Ať Supabase nové sloupce a tabulky hned uvidí.
notify pgrst, 'reload schema';

select co as "co se delo", vysledek as "vysledek" from _migrace_zprava order by poradi;
