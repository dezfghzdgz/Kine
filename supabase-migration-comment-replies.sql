-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Přidává možnost odpovídat na komentáře (jednoduché vlákno).

alter table comments add column parent_id uuid references comments(id) on delete cascade;
