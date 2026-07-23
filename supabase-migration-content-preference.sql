-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
alter table profiles add column if not exists content_preference text check (content_preference in ('short', 'long'));
