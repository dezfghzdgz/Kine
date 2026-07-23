-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table profiles add column if not exists trailer_video_id uuid references videos(id) on delete set null;
