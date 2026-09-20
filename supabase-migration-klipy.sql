-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- KLIPY (lib/clips.ts, app/api/videos/clip)
--
-- Divák u videa označí od-do (3-60 s) a Cloudflare z toho vyrobí nové
-- krátké video. Klip je obyčejný řádek ve videos - hraje, sdílí se a
-- počítá zhlédnutí jako každé jiné video - jen si navíc pamatuje, z čeho
-- vznikl a kdo ho vystřihl. Vlastníkem zůstává původní tvůrce (zhlédnutí
-- a výdělky jsou jeho); klipující je uvedený pod videem.
--
-- Bez téhle migrace tlačítko Klip hlásí chybu a všechno ostatní jede dál.

alter table videos add column if not exists clipped_from_video_id uuid references videos(id) on delete set null;
alter table videos add column if not exists clipped_by uuid references profiles(id) on delete set null;

create index if not exists idx_videos_clipped_from on videos (clipped_from_video_id) where clipped_from_video_id is not null;
create index if not exists idx_videos_clipped_by on videos (clipped_by) where clipped_by is not null;

comment on column videos.clipped_from_video_id is 'Klip: z jakého videa vznikl (lib/clips.ts).';
comment on column videos.clipped_by is 'Klip: kdo ho vystřihl. Vlastníkem klipu zůstává tvůrce původního videa.';
