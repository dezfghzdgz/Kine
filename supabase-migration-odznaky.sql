-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- ODZNAKY: výběr na kanál a oznámení o novém odznaku
--
-- 1) profiles.badge_showcase - které odznaky (nejvýš 3) si tvůrce vybral na
--    kanál. Prázdné (null) = ještě nevybíral, ukážou se první tři. Ukazuje se
--    jen to, co opravdu má - podvržený výběr nic nepřidá (odznaky se počítají
--    z videí, zhlédnutí a odběratelů, ne z tohohle sloupce).
-- 2) profiles.badges_seen - o kterých odznacích tvůrce už ví (ať oznámení
--    o novém odznaku přijde jednou). Zapisuje server (/api/badges/check).
-- 3) Oznámení druhu "badge" (zvoneček).
--
-- Bez tohohle skriptu web funguje dál: odznaky na kanálu jsou vidět (první
-- tři), jen výběr nejde uložit a oznámení o nových odznacích se neposílají.
-- Skript jde spustit i víckrát.

alter table profiles add column if not exists badge_showcase text[];
alter table profiles add column if not exists badges_seen text[];

-- Výběr odznaků je veřejný (vidí ho každý na kanálu). Po migraci "privacy-fixes"
-- se sloupce profilu z prohlížeče čtou jen jmenovitě povolené - nový se musí povolit.
-- badges_seen zůstává jen pro server.
grant select (badge_showcase) on profiles to anon, authenticated;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'view_milestone', 'donation',
                  'subscription', 'new_video', 'comment_reply', 'moderation_warning', 'live', 'badge'));
