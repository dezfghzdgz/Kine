-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table profiles add column if not exists viewer_type text check (viewer_type in ('viewer', 'creator'));
