-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- SRDÍČKO OD TVŮRCE U KOMENTÁŘE
-- Tvůrce videa může komentář označit srdíčkem ("tohle se mi líbí, díky").
-- Vidí ho všichni. Nastavit ho smí jen majitel videa - hlídá to už
-- existující pravidlo "Vlastník videa může připnout komentář na svém
-- videu" (update na comments podle videos.owner_id = auth.uid()).

alter table comments add column if not exists hearted_by_creator boolean not null default false;
