-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table videos add column made_for_kids boolean default false;
alter table videos add column scheduled_at timestamp with time zone;
