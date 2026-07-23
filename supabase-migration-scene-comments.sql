-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
alter table comments add column if not exists timestamp_seconds int;
