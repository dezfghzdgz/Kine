-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- ŽIVÉ VYSÍLÁNÍ 3 (říjen 2026)
--
--   1. Vlastní náhled přenosu (obrázek v řadě "Živě", na stránce Živě
--      a v náhledu odkazu). Nahrává se ve studiu /live nebo v appce Kine.
--      Bez vlastního náhledu se ukazuje snímek z vysílání - jako dřív.
--
-- Dá se pustit opakovaně. Web funguje i bez ní - jen bez vlastního náhledu.
-- Na konci vypíše tabulku s tím, co udělal.

drop table if exists _migrace_zprava;
create temp table _migrace_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 1. Vlastní náhled přenosu
-- =====================================================================
-- Obrázek leží v úložišti Kine (bucket "thumbnails", složka kanálu) - nahrává
-- ho server (app/api/live/thumbnail), takže prohlížeč k tomu žádné nové
-- oprávnění nepotřebuje.
do $mig$
begin
  if to_regclass('public.live_streams') is null then
    insert into _migrace_zprava (co, vysledek) values ('vlastni nahled prenosu', 'tabulka live_streams neexistuje (spust supabase-migration-zive-vysilani.sql), preskoceno');
    return;
  end if;
  execute 'alter table live_streams add column if not exists thumbnail_url text';
  insert into _migrace_zprava (co, vysledek) values ('vlastni nahled prenosu', 'hotovo');
end $mig$;

-- Bucket na náhledy (je už z migrace custom-thumbnails; kdyby chyběl, založí se).
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;
insert into _migrace_zprava (co, vysledek) values ('bucket thumbnails', 'je');


-- Ať Supabase nové sloupce hned uvidí.
notify pgrst, 'reload schema';

select co as "co se delo", vysledek as "vysledek" from _migrace_zprava order by poradi;
