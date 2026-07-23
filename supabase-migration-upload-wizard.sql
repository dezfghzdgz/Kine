-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table videos add column category text;
alter table videos add column language text default 'cs';
alter table videos add column has_paid_promotion boolean default false;
alter table videos add column visibility text default 'public' check (visibility in ('public', 'subscribers', 'private'));
alter table videos add column is_premiere boolean default false;
