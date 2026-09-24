-- ============================================================================
-- Živé vysílání (Cloudflare Stream Live), chat k živému vysílání a premiérám,
-- oznámení odběratelům až při zveřejnění videa.
--
-- Spusť celé v Supabase -> SQL Editor. Dá se pustit i víckrát (nic se
-- nezdvojí). Bez téhle migrace stránky /live a chat jen ukážou, že živé
-- vysílání ještě není zapnuté - nic jiného se nerozbije.
-- ============================================================================

-- 1) Klíč pro vysílání (OBS). Je TAJNÝ: kdo ho má, vysílá za kanál. Proto
--    k tabulce nemá prohlížeč žádný přístup - čte a zapisuje jen server
--    (/api/live/me), a ten ho vydá jen majiteli kanálu.
create table if not exists live_inputs (
  owner_id uuid primary key references profiles(id) on delete cascade,
  cf_input_id text not null unique,
  rtmps_url text not null,
  stream_key text not null,
  srt_url text,
  created_at timestamptz not null default now()
);
alter table live_inputs enable row level security;
-- Schválně žádná politika: anon ani přihlášený k tabulce nesmí vůbec.

-- 2) Veřejný stav vysílání kanálu (jestli je živě, název, od kdy).
create table if not exists live_streams (
  owner_id uuid primary key references profiles(id) on delete cascade,
  cf_input_id text not null,
  title text not null default '',
  description text not null default '',
  category text,
  is_live boolean not null default false,
  current_video_uid text,
  started_at timestamptz,
  ended_at timestamptz,
  checked_at timestamptz,
  notified_video_uid text,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table live_streams enable row level security;
do $$ begin
  create policy "Stav živého vysílání je veřejný" on live_streams for select using (true);
exception when duplicate_object then null; end $$;
create index if not exists live_streams_is_live_idx on live_streams (is_live) where is_live;

-- 3) Chat: živé vysílání (room = 'channel:<id kanálu>') a premiéry
--    (room = 'video:<id videa>'). Číst smí kdokoliv; psát a mazat jen přes
--    server (/api/live/chat), který hlídá přihlášení, blokaci a tempo psaní.
create table if not exists live_chat_messages (
  id bigint generated always as identity primary key,
  room text not null check (char_length(room) <= 80),
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists live_chat_messages_room_idx on live_chat_messages (room, id desc);
create index if not exists live_chat_messages_user_idx on live_chat_messages (user_id, created_at desc);
alter table live_chat_messages enable row level security;
do $$ begin
  create policy "Chat je veřejně čitelný" on live_chat_messages for select using (true);
exception when duplicate_object then null; end $$;

-- 4) Nový druh oznámení: "je živě".
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'view_milestone', 'donation',
                  'subscription', 'new_video', 'comment_reply', 'moderation_warning', 'live'));

-- 5) Oznámení o novém videu jen jednou a až ve chvíli zveřejnění (naplánovaná
--    videa a premiéry dřív dostávali odběratelé hned po nahrání - a dvakrát).
alter table videos add column if not exists subscribers_notified_at timestamptz;
-- Všechno, co už je zpracované, se bere jako oznámené (oznámení dřív chodila
-- hned) - jinak by to po migraci dostali odběratelé znovu.
update videos set subscribers_notified_at = now()
where subscribers_notified_at is null and status = 'ready';
create index if not exists videos_pending_notify_idx on videos (scheduled_at)
  where subscribers_notified_at is null;

-- 6) Automatické titulky (Cloudflare AI): stav requested / done / failed.
alter table videos add column if not exists auto_captions text;
