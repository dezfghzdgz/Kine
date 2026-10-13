-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- ŽIVĚ: KONEC Z APPKY PLATÍ + SPECIÁLNÍ ODZNAKY
--
-- 1) live_streams.app_stopped_at / stopped_video_uid - kdy appka řekla
--    "skončil jsem" a který záznam tím skončil. Cloudflare po odpojení ještě
--    minuty hlásí video jako běžící a vysílání pak "po konci pořád viselo
--    v Živě". Teď se tentýž záznam po Ukončit sám nevrátí (lib/liveSignal.ts).
-- 2) profile_special_badges - speciální odznaky, které přiděluje tým Kine
--    (Majitel, Vývojář, Tým Kine, Moderátor, Beta tester, Partner, Lovec
--    chyb) na /admin/badges. Vidí je každý, zapisuje jen server - sám si je
--    nikdo dát nemůže.
-- 3) Účtu "bezejmena" odznak Majitel Kine.
--
-- Bez skriptu web funguje dál: konec vysílání se pozná jako dřív a
-- speciální odznaky nejsou. Skript jde spustit i víckrát.

-- 1) Konec vysílání z appky ------------------------------------------------
do $$ begin
  if to_regclass('public.live_streams') is not null then
    execute 'alter table live_streams add column if not exists app_stopped_at timestamptz';
    execute 'alter table live_streams add column if not exists stopped_video_uid text';
  end if;
end $$;

-- 2) Speciální odznaky ------------------------------------------------------
create table if not exists profile_special_badges (
  profile_id uuid not null references profiles(id) on delete cascade,
  badge text not null,
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, badge)
);

alter table profile_special_badges drop constraint if exists profile_special_badges_badge_check;
alter table profile_special_badges add constraint profile_special_badges_badge_check
  check (badge in ('owner', 'dev', 'team', 'moderator', 'betaTester', 'partner', 'bugHunter'));

alter table profile_special_badges enable row level security;

-- Číst smí každý (odznaky jsou na kanálu vidět); zápis jen server (service role),
-- pro přihlášené žádné pravidlo na zápis - sám si odznak nikdo nedá.
drop policy if exists "Speciální odznaky vidí každý" on profile_special_badges;
create policy "Speciální odznaky vidí každý" on profile_special_badges for select using (true);
revoke insert, update, delete on profile_special_badges from anon, authenticated;
grant select on profile_special_badges to anon, authenticated;

-- 3) Majitel Kine pro účet "bezejmena" ----------------------------------------
insert into profile_special_badges (profile_id, badge)
select id, 'owner' from profiles where lower(username) = 'bezejmena'
on conflict (profile_id, badge) do nothing;

do $$ begin
  if not exists (select 1 from profiles where lower(username) = 'bezejmena') then
    raise notice 'Účet "bezejmena" jsem nenašel - odznak Majitel Kine si přiděl na /admin/badges.';
  end if;
end $$;
