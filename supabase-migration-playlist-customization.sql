-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table playlists add column if not exists color text default '#3a3a40';
alter table playlists add column if not exists is_system boolean default false;

-- Každému stávajícímu účtu, co ještě nemá "Sledovat později", ho založíme
insert into playlists (owner_id, title, color, is_system)
select id, 'Sledovat později', '#3a5a8a', true
from profiles
where not exists (
  select 1 from playlists where playlists.owner_id = profiles.id and playlists.is_system = true
);
