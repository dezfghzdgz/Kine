-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table watch_history add column if not exists progress_seconds integer default 0;
alter table watch_history add column if not exists completed boolean default false;
