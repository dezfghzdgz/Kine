-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- Dvě věci z jednoho kola:
--   1) zařízení u zhlédnutí (telefon / tablet / počítač / TV)
--   2) tabulka pro chyby hlášené z prohlížeče


-- ===========================================================================
-- 1) NA ČEM SE KINE SLEDUJE
-- ===========================================================================
-- Nevěděli jsme, jestli se Kine používá spíš na mobilu nebo na počítači.
-- Odteď si appka ke každému zhlédnutí poznamená třídu zařízení. Jen jednu
-- ze čtyř hodnot, nic víc - žádný otisk prohlížeče.

alter table views_log add column if not exists device text;

do $$
begin
  alter table views_log add constraint views_log_device_check
    check (device is null or device in ('phone', 'tablet', 'desktop', 'tv')) not valid;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_views_log_video_device on views_log (video_id, device);

-- Rychlý přehled (za posledních 30 dní):
--   select coalesce(device, 'neznámé') as zarizeni, count(*)
--   from views_log
--   where viewed_at > now() - interval '30 days'
--   group by 1 order by 2 desc;


-- ===========================================================================
-- 2) CHYBY Z PROHLÍŽEČE
-- ===========================================================================
-- Do teď se každá chyba v appce našla ručně - někdo si všiml, že něco
-- nefunguje. Odteď se chyby z prohlížeče posílají na /api/client-errors
-- a ukládají sem; přehled je na /admin/errors.
--
-- Zabezpečení: tabulka má zapnuté RLS a ŽÁDNÁ pravidla, takže z prohlížeče
-- ji nikdo nepřečte ani do ní nezapíše. Zapisuje jen server (service role)
-- a čte jen server po ověření is_admin.

create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  message text not null,
  stack text,
  url text,
  user_agent text,
  device text,
  user_id uuid references profiles(id) on delete set null,
  fingerprint text not null
);

alter table client_errors enable row level security;

create index if not exists idx_client_errors_created on client_errors (created_at desc);
create index if not exists idx_client_errors_fingerprint on client_errors (fingerprint, created_at desc);

comment on table client_errors is
  'Chyby JavaScriptu z prohlížečů návštěvníků. Zapisuje jen server, čte jen admin. Starší než 30 dní se mažou.';

-- Úklid - spouštěj občas ručně (nebo si na to nastav pg_cron, pokud ho máš):
--   delete from client_errors where created_at < now() - interval '30 days';
