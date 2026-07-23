-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
alter table videos add column if not exists is_ai_generated boolean default false;
