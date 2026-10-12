-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- ŽIVÉ VYSÍLÁNÍ 2 (říjen 2026)
--
--   1. Záznam vysílání se po skončení může zveřejnit sám (studio / appka).
--   2. Záznam chatu u zveřejněného záznamu vysílání (přehrává se s videem).
--   3. Pravidla chatu: pomalý režim, jen odběratelé, zákaz odkazů,
--      zakázaná slova, štít, ztlumení a zákaz psaní, moderátoři kanálu.
--   4. Sloupce pro vysílání z appky (pokud ještě nejsou z dřívějších migrací).
--
-- Dá se pustit opakovaně. Web funguje i bez ní - jen bez těchhle novinek.
-- Na konci vypíše tabulku s tím, co udělal.

drop table if exists _migrace_zprava;
create temp table _migrace_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 1. Přenos: automatické zveřejnění záznamu + hlášení z appky
-- =====================================================================
do $mig$
begin
  if to_regclass('public.live_streams') is null then
    insert into _migrace_zprava (co, vysledek) values ('live_streams', 'tabulka neexistuje (spust supabase-migration-zive-vysilani.sql), preskoceno');
    return;
  end if;
  -- null = záznam zůstane ve studiu; jinak se po skončení zveřejní s touhle viditelností.
  execute 'alter table live_streams add column if not exists recording_visibility text';
  execute 'alter table live_streams drop constraint if exists live_streams_recording_visibility_check';
  execute $c$alter table live_streams add constraint live_streams_recording_visibility_check
             check (recording_visibility is null or recording_visibility in ('public', 'subscribers', 'private'))$c$;
  execute 'alter table live_streams add column if not exists app_ping_at timestamptz';
  execute 'alter table live_streams add column if not exists cf_confirmed_at timestamptz';
  insert into _migrace_zprava (co, vysledek) values ('vysilani: automaticke zverejneni zaznamu, hlaseni z appky', 'hotovo');
end $mig$;


-- =====================================================================
-- 2. Záznam chatu u záznamu vysílání
-- =====================================================================
-- Video vzniklé ze záznamu si pamatuje, ke kterému chatu patří a kdy
-- vysílání začalo - stránka videa pak přehrává zprávy ve stejné chvíli,
-- kdy padly. Zprávy samotné zůstávají v live_chat_messages.
do $mig$
begin
  if to_regclass('public.videos') is not null then
    execute 'alter table videos add column if not exists live_room text';
    execute 'alter table videos add column if not exists live_started_at timestamptz';
  end if;
  if to_regclass('public.live_chat_messages') is not null then
    execute 'create index if not exists live_chat_messages_room_created_idx on live_chat_messages (room, created_at)';
  end if;
  insert into _migrace_zprava (co, vysledek) values ('zaznam chatu u videa', 'hotovo');
end $mig$;


-- =====================================================================
-- 3. Pravidla chatu, ztlumení, moderátoři kanálu
-- =====================================================================
-- Všechno jde jen přes server (/api/live/chat, /api/live/moderators) -
-- proto RLS zapnuté a žádná politika: z prohlížeče se k tabulkám nedá
-- dostat vůbec (zakázaná slova nemají být vidět, jinak by je šlo obejít).

create table if not exists live_chat_settings (
  room text primary key check (char_length(room) <= 80),
  slow_seconds int not null default 0 check (slow_seconds between 0 and 600),
  followers_only boolean not null default false,
  follow_minutes int not null default 0 check (follow_minutes between 0 and 43200),
  block_links boolean not null default false,
  blocked_terms text[] not null default '{}',
  min_account_minutes int not null default 0 check (min_account_minutes between 0 and 43200),
  shield boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table live_chat_settings enable row level security;

create table if not exists live_chat_bans (
  room text not null check (char_length(room) <= 80),
  user_id uuid not null references profiles(id) on delete cascade,
  -- null = napořád, jinak ztlumení do téhle chvíle
  until timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room, user_id)
);
alter table live_chat_bans enable row level security;

create table if not exists channel_moderators (
  channel_id uuid not null references profiles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id),
  check (channel_id <> user_id)
);
alter table channel_moderators enable row level security;
create index if not exists channel_moderators_user_idx on channel_moderators (user_id);

insert into _migrace_zprava (co, vysledek) values ('pravidla chatu, ztlumeni, moderatori kanalu', 'hotovo');


-- Ať Supabase nové sloupce a tabulky hned uvidí.
notify pgrst, 'reload schema';

select co as "co se delo", vysledek as "vysledek" from _migrace_zprava order by poradi;
