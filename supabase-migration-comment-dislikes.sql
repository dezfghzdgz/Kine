-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
alter table comment_reactions add column if not exists type text default 'like' check (type in ('like', 'dislike'));
