-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
alter table profiles add column if not exists agreed_to_rules boolean default false;
alter table profiles add column if not exists agreed_to_rules_at timestamp with time zone;
