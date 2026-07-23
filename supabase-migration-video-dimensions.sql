-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
alter table videos add column if not exists width int;
alter table videos add column if not exists height int;
