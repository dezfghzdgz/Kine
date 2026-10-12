-- ============================================================================
-- Živé vysílání: stav přenosů (tabulka live_streams) už prohlížeč nečte napřímo.
--
-- Spusť celé v Supabase -> SQL Editor -> New query -> Run. Dá se pustit
-- i víckrát. Je to VOLITELNÉ: bez téhle migrace funguje všechno stejně.
--
-- Proč: tabulka byla veřejně čitelná přes veřejný (anon) klíč - pravidlo
-- "Stav živého vysílání je veřejný". Web ani appka ji napřímo nečtou,
-- všechno jde přes server (/api/live/...), který hlídá, co kdo smí vidět
-- (skrytý přenos, shadow-ban, zablokovaný kanál). Přímo z tabulky šlo ale
-- přečíst i video přenosu, který automatická kontrola obsahu skryla
-- (čeká na moderátora), a pustit si ho mimo Kine. Server používá klíč
-- service role, který pravidla obchází - jemu se nic nemění.
-- ============================================================================

drop policy if exists "Stav živého vysílání je veřejný" on live_streams;
