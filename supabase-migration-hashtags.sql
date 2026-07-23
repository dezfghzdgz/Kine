-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table videos add column if not exists hashtags text[] default '{}';
create index if not exists idx_videos_hashtags on videos using gin (hashtags);
