-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- SOUKROMÍ A VYNUCOVÁNÍ PRAVIDEL
--
-- Navazuje na supabase-migration-security-fixes.sql - tu spusť první.
--
-- POZOR: k téhle migraci patří i úprava kódu. Nasaď obojí naráz, jinak
-- appka přestane vidět věci, které si teď bere přímo z tabulky profiles.
--
-- Skript je psaný tak, aby se dal pustit opakovaně a aby nespadl ani na
-- databázi, kde neproběhly všechny starší migrace. Na konci vypíše
-- tabulku s tím, co udělal - tu si přečti, je v ní i to, co se udělat
-- nepodařilo.


-- =====================================================================
-- 0. Sloupce, na kterých tenhle skript stojí
-- =====================================================================
-- Tady spadly předchozí dva pokusy. Supabase pouští celý skript jako
-- jednu transakci: jediný příkaz, který se odvolá na sloupec, co
-- v databázi není, shodí úplně všechno - a to i příkazy, které už
-- proběhly. Proto se nevytvořila ani funkce my_account() a appka na její
-- volání dostávala 404.
--
-- Konkrétně chyběly stripe_account_id a stripe_onboarding_complete, což
-- znamená, že u tebe nikdy neproběhla supabase-migration-creator-
-- subscriptions.sql. Doplní se tu přesně tak, jak je zakládá ona, takže
-- až ji pustíš celou (kvůli tabulce channel_subscriptions), nic
-- nerozbije - "if not exists" ji nechá projít bez povšimnutí.
--
-- Pravidlo pro příště: každý sloupec, který tenhle skript jmenuje, musí
-- být nejdřív tady.

alter table profiles add column if not exists role text not null default 'user'
  check (role in ('user', 'moderator', 'admin'));
alter table profiles add column if not exists is_admin boolean default false;
alter table profiles add column if not exists is_banned boolean not null default false;
alter table profiles add column if not exists is_shadow_banned boolean not null default false;
alter table profiles add column if not exists payouts_suspended boolean not null default false;

alter table profiles add column if not exists revenue_share_percent int not null default 25
  check (revenue_share_percent between 0 and 100);
alter table profiles add column if not exists revenue_share_manual boolean not null default false;
alter table profiles add column if not exists partner_status text not null default 'standard'
  check (partner_status in ('standard', 'partner', 'sanctioned'));
alter table profiles add column if not exists revenue_share_note text;

alter table profiles add column if not exists stripe_account_id text;
alter table profiles add column if not exists stripe_onboarding_complete boolean not null default false;
alter table profiles add column if not exists subscription_price_eur numeric;
alter table profiles add column if not exists subscription_stripe_price_id text;

alter table profiles add column if not exists agreed_to_rules boolean default false;

-- Zápisník, ze kterého se na konci vypíše souhrn.
drop table if exists _migrace_zprava;
create temp table _migrace_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 1. Vlastní údaje a moderátorské údaje jdou přes funkce
-- =====================================================================
-- Tabulka profiles byla celá veřejně čitelná. Politika "for select using
-- (true)" je z první verze appky a platí i pro sloupce, které přibyly
-- potom. Anon klíč je ve veřejném JS, takže si kdokoliv mohl z konzole
-- prohlížeče vypsat:
--
--   select id from profiles where is_shadow_banned = true   <- shadow ban k ničemu
--   select username, revenue_share_note from profiles       <- poznámky moderátora
--   select username from profiles where is_admin            <- koho napadnout
--
-- RLS umí schovat řádek, ne sloupec - na sloupce jsou práva. Řádková
-- politika zůstává, jak byla (profily jsou veřejné), jen se z citlivých
-- sloupců sundá právo číst. Co appka opravdu potřebuje, dostane funkcí,
-- která vydá jen to, na co má volající nárok.

-- Jsem moderátor? Odpovídá jen za volajícího.
-- Klíčové je "security definer": funkce běží s právy toho, kdo ji
-- založil, takže si přečte role i tehdy, když volající na ten sloupec
-- právo nemá. Bez toho by nešlo sloupec zavřít a zároveň nechat
-- fungovat politiky (viz bod 2).
--
-- Funkce jsou schválně dvě. Appka totiž is_admin a moderátorskou roli
-- odděluje - v lib/useUserRole.ts je to napsané výslovně: "is_admin
-- schválně nedělá z člověka moderátora". Kdyby tu byla jen jedna
-- funkce, přepis politik v bodě 2 by tenhle rozdíl potichu smazal a
-- každý admin by rázem směl mazat cizí videa a komentáře. Každá
-- politika tak dostane přesně tu funkci, která odpovídá její původní
-- podmínce.

-- role = 'moderator' nebo 'admin'
create or replace function is_staff()
returns boolean as $$
  select coalesce((
    select p.role in ('moderator', 'admin') from profiles p where p.id = auth.uid()
  ), false);
$$ language sql security definer stable;

-- totéž, a navíc příznak is_admin
create or replace function is_staff_or_admin()
returns boolean as $$
  select coalesce((
    select p.role in ('moderator', 'admin') or coalesce(p.is_admin, false)
    from profiles p where p.id = auth.uid()
  ), false);
$$ language sql security definer stable;

grant execute on function is_staff() to anon, authenticated, service_role;
grant execute on function is_staff_or_admin() to anon, authenticated, service_role;

-- Svoje vlastní nastavení (jsem admin? jaký mám podíl?) appka potřebuje.
-- Práva na sloupce jsou ale všechno nebo nic - nejde říct "jen svůj
-- řádek". Proto funkce, která schválně vrací jen řádek volajícího.
create or replace function my_account()
returns table (
  role text,
  is_admin boolean,
  is_banned boolean,
  is_shadow_banned boolean,
  payouts_suspended boolean,
  revenue_share_percent int,
  revenue_share_manual boolean,
  partner_status text,
  revenue_share_note text,
  stripe_account_id text,
  stripe_onboarding_complete boolean,
  agreed_to_rules boolean
) as $$
  select
    p.role, p.is_admin, p.is_banned, p.is_shadow_banned, p.payouts_suspended,
    p.revenue_share_percent, p.revenue_share_manual, p.partner_status,
    p.revenue_share_note, p.stripe_account_id, p.stripe_onboarding_complete,
    p.agreed_to_rules
  from profiles p
  where p.id = auth.uid();
$$ language sql security definer stable;

-- "revoke from anon" nestačí: nová funkce má právo spouštět rovnou každý
-- (Postgres ji zakládá s grantem pro PUBLIC), takže nepřihlášený by se
-- k ní dostal i po odebrání práva roli anon.
revoke execute on function my_account() from public, anon;
grant execute on function my_account() to authenticated, service_role;

-- Moderátor potřebuje vidět stav cizího kanálu. Funkce ho vydá jen tehdy,
-- když volající opravdu moderátor nebo admin je - pro ostatní vrátí prázdno.
create or replace function moderation_flags(channel_id uuid)
returns table (is_banned boolean, is_shadow_banned boolean, payouts_suspended boolean) as $$
  select p.is_banned, p.is_shadow_banned, p.payouts_suspended
  from profiles p
  where p.id = channel_id and is_staff_or_admin();
$$ language sql security definer stable;

revoke execute on function moderation_flags(uuid) from public, anon;
grant execute on function moderation_flags(uuid) to authenticated, service_role;

create or replace function owner_is_shadow_banned(owner uuid)
returns boolean as $$
  select coalesce((select p.is_shadow_banned from profiles p where p.id = owner), false);
$$ language sql security definer stable;


-- =====================================================================
-- 2. Politiky, které si samy čtou profiles
-- =====================================================================
-- Tohle je věc, kterou jsem si všiml až při zkoušce na skutečném
-- Postgresu, a je vážnější než ten původní problém.
--
-- Spousta politik vypadá takhle:
--
--   using (exists (select 1 from profiles p
--                  where p.id = auth.uid() and p.role in ('moderator','admin')))
--
-- Podmínku politiky vyhodnocuje databáze pod právy toho, kdo se ptá.
-- Jakmile se uživateli sebere právo číst profiles.role, tenhle poddotaz
-- skončí chybou "permission denied for table profiles" - a s ním celý
-- dotaz. Neselže tedy jen čtení jednoho sloupce: přestane fungovat
-- moderátorská fronta hlášení, mazání cizích videí a komentářů,
-- vypínání komentářů i blokování účtů. Kdybych to jen odebral, jak jsem
-- původně chtěl, rozbil bych ti moderování.
--
-- Řešení: ty politiky se přepíšou na funkci. Ta je security definer,
-- takže si role přečte sama a volající na to právo mít nemusí.
--
-- Přepisuje se jen tehdy, když podmínka přesně sedí na známý tvar, a
-- každý tvar dostane funkci se stejným významem, jaký měl předtím:
--   "role in (moderator, admin)"              -> is_staff()
--   "role in (moderator, admin) or is_admin"  -> is_staff_or_admin()
-- Cokoliv jiného zůstane nedotčené - radši nechám sloupec veřejný, než
-- abych naslepo přepsal politiku, kterou neznám.

do $mig$
declare
  pol record;
  norm text;
  alias text;
  nahrada text;
  prepsano int := 0;
  preskoceno text[] := '{}';
  tvar_a constant text :=
    '(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY[''moderator''::text, ''admin''::text])))))';
  tvar_b constant text :=
    '(EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND ((profiles.role = ANY (ARRAY[''moderator''::text, ''admin''::text])) OR profiles.is_admin))))';
begin
  for pol in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') like '%profiles%'
      and coalesce(with_check, '') = ''
      and cmd in ('SELECT', 'UPDATE', 'DELETE', 'INSERT', 'ALL')
  loop
    -- Zápis podmínky si Postgres přeformátuje po svém. Sjednotí se
    -- mezery a alias tabulky, ať se dá porovnat na přesnou shodu.
    norm := regexp_replace(pol.qual, '\s+', ' ', 'g');
    alias := (regexp_match(norm, 'FROM profiles ([a-z_]+) WHERE'))[1];
    if alias is not null then
      norm := replace(norm, 'FROM profiles ' || alias || ' WHERE', 'FROM profiles WHERE');
      norm := replace(norm, alias || '.', 'profiles.');
    end if;

    nahrada := case norm when tvar_a then 'is_staff()'
                         when tvar_b then 'is_staff_or_admin()'
                         else null end;

    if nahrada is not null then
      execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
      execute format(
        'create policy %I on %I.%I as %s for %s to %s using (' || nahrada || ')',
        pol.policyname, pol.schemaname, pol.tablename,
        case when pol.permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
        case when pol.cmd = 'ALL' then 'all' else lower(pol.cmd) end,
        -- role se musí přepsat přesně tak, jak byly; "public" se ale
        -- uvozovkami označit nesmí, to je klíčové slovo, ne jméno role
        (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ')
           from unnest(pol.roles) r)
      );
      prepsano := prepsano + 1;
    else
      preskoceno := preskoceno || (pol.tablename || '.' || pol.policyname);
    end if;
  end loop;

  insert into _migrace_zprava (co, vysledek)
  values ('politiky prepsane na funkci is_staff()/is_staff_or_admin()', prepsano::text);

  if array_length(preskoceno, 1) is not null then
    insert into _migrace_zprava (co, vysledek)
    values ('politiky, ktere si ctou profiles po svem (nechany beze zmeny)',
            array_to_string(preskoceno, ', '));
  end if;
end $mig$;


-- =====================================================================
-- 3. Sundání práv na citlivé sloupce
-- =====================================================================
-- Seznam citlivých sloupců je vypsaný ručně - když někdy přidáš další,
-- dopiš ho sem, jinak bude veřejně čitelný. Ale jestli sloupec
-- v databázi opravdu je, se dohledá, takže chybějící sloupec už skript
-- neshodí.
--
-- Druhá pojistka: pokud na některý z těch sloupců pořád sahá nějaká
-- politika nebo funkce, která nemá security definer, právo se mu
-- nesebere. Radši nechám něco veřejné, než abych ti tichou chybou
-- vypnul půlku appky. Co takhle zůstalo, je v souhrnu na konci.

do $mig$
declare
  citlive constant text[] := array[
    'is_admin', 'role', 'is_banned', 'is_shadow_banned', 'payouts_suspended',
    'revenue_share_percent', 'revenue_share_manual', 'partner_status', 'revenue_share_note',
    'stripe_account_id', 'stripe_onboarding_complete', 'subscription_stripe_price_id',
    'username_exempt', 'agreed_to_rules', 'agreed_to_rules_at'
  ];
  potrebne text[] := '{}';
  sloupec text;
  skryte text[] := '{}';
  verejne text;
begin
  -- Na co ještě sahají politiky?
  foreach sloupec in array citlive loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%profiles%'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ ('\m' || sloupec || '\M')
    ) then
      potrebne := potrebne || sloupec;
    end if;
  end loop;

  -- A na co sahají funkce, které běží pod právy volajícího?
  foreach sloupec in array citlive loop
    if not (sloupec = any (potrebne)) and exists (
      select 1 from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
      where n.nspname = 'public'
        and not pr.prosecdef
        and pr.prosrc ilike '%profiles%'
        and pr.prosrc ~ ('\m' || sloupec || '\M')
    ) then
      potrebne := potrebne || sloupec;
    end if;
  end loop;

  select coalesce(string_agg(quote_ident(column_name), ', '), 'id')
    into verejne
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and (column_name <> all (citlive) or column_name = any (potrebne));

  select array_agg(column_name order by column_name)
    into skryte
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = any (citlive)
    and not (column_name = any (potrebne));

  execute 'revoke select on profiles from anon, authenticated';
  execute format('grant select (%s) on profiles to anon, authenticated', verejne);

  insert into _migrace_zprava (co, vysledek)
  values ('profiles: sloupce nove nedostupne z prohlizece',
          coalesce(array_to_string(skryte, ', '), '(zadne)'));

  if array_length(potrebne, 1) is not null then
    insert into _migrace_zprava (co, vysledek)
    values ('profiles: zustaly verejne, protoze je potrebuje politika nebo funkce',
            array_to_string(potrebne, ', '));
  end if;
end $mig$;


-- =====================================================================
-- 4. Shadow ban hlídá databáze, ne prohlížeč
-- =====================================================================
-- Hlavní stránka si dosud tahala seznam shadow-bannovaných a filtrovala
-- si ho sama. To znamenalo dvě věci: seznam byl veřejný (viz bod 1) a
-- filtrovalo se jen tam, kde na to někdo myslel - v Exploreru, hledání
-- ani na hashtazích ne. Teď to platí všude.
--
-- "as restrictive" znamená, že se to k dosavadním politikám přidá jako
-- další podmínka (A ZÁROVEŇ), ne jako další povolená cesta.

drop policy if exists "Shadow ban schová videa ostatním" on videos;
create policy "Shadow ban schová videa ostatním" on videos
  as restrictive for select
  using (owner_id = auth.uid() or not owner_is_shadow_banned(owner_id));


-- =====================================================================
-- 5. Záznam zhlédnutí vydával IP adresy komukoliv
-- =====================================================================
-- "Views log je veřejně čitelný" znamenalo, že si kdokoliv mohl stáhnout
-- IP adresy všech diváků a spárovat je s videi. To je osobní údaj.
--
-- IP adresu odteď nepřečte z prohlížeče nikdo (potřebuje ji jen serverová
-- ochrana proti nahánění zhlédnutí, a ta jede přes service role). Zbytek
-- řádku vidí jen majitel videa - kvůli statistikám kanálu.

do $mig$
declare
  verejne text;
begin
  if to_regclass('public.views_log') is null then
    insert into _migrace_zprava (co, vysledek)
    values ('views_log', 'tabulka neexistuje, preskoceno');
    return;
  end if;

  select coalesce(string_agg(quote_ident(column_name), ', '), 'id')
    into verejne
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'views_log'
    and column_name <> 'ip_address';

  execute 'revoke select on views_log from anon, authenticated';
  execute format('grant select (%s) on views_log to authenticated', verejne);

  execute 'drop policy if exists "Views log je veřejně čitelný" on views_log';
  execute 'drop policy if exists "Zhlédnutí vidí jen majitel videa" on views_log';
  execute 'create policy "Zhlédnutí vidí jen majitel videa" on views_log
             for select to authenticated
             using (exists (select 1 from videos v
                            where v.id = views_log.video_id and v.owner_id = auth.uid()))';

  insert into _migrace_zprava (co, vysledek) values ('views_log: ip_address', 'skryta');
end $mig$;


-- =====================================================================
-- 6. Oznámení nesmí vést mimo appku
-- =====================================================================
-- Vytvořit oznámení komukoliv smí kdokoliv přihlášený - appka to tak
-- používá (lajk, odběr, odpověď). Zneužít se to dalo tím, že si útočník
-- napsal vlastní text a vlastní odkaz: "Tvůj účet bude smazán, ověř se
-- zde" s odkazem na cizí stránku. Odkaz teď musí mířit dovnitř appky,
-- takže phishing tudy neprojde.
--
-- Podmínka se přidává jako "not valid": platí na všechno nové, ale staré
-- řádky se neprověřují. Kdyby se prověřovaly a jediný starý záznam měl
-- odkaz ven, spadl by celý skript - a to je přesně ta past, kvůli které
-- tahle migrace dvakrát neprošla. Kolik takových řádků máš, je v souhrnu.

do $mig$
declare
  spatnych int := 0;
begin
  if to_regclass('public.notifications') is null then
    insert into _migrace_zprava (co, vysledek) values ('notifications', 'tabulka neexistuje, preskoceno');
    return;
  end if;

  execute 'alter table notifications drop constraint if exists notifications_link_internal';
  execute 'alter table notifications add constraint notifications_link_internal
             check (link is null or link like ''/%'') not valid';

  execute 'select count(*) from notifications where link is not null and link not like ''/%'''
    into spatnych;

  insert into _migrace_zprava (co, vysledek)
  values ('notifications: stare zaznamy s odkazem ven (nove uz neprojdou)', spatnych::text);
end $mig$;


-- =====================================================================
-- 7. Zablokovaný účet je teď opravdu zablokovaný
-- =====================================================================
-- is_banned se dosud jen nastavilo a nikdo ho nečetl - zabanovaný člověk
-- dál nahrával i komentoval. Tohle mu to zatrhne přímo v databázi, takže
-- na to nemusí myslet každá stránka zvlášť.

create or replace function reject_if_banned()
returns trigger as $$
begin
  if auth.role() <> 'service_role'
     and exists (select 1 from profiles p where p.id = auth.uid() and p.is_banned) then
    raise exception 'Účet je zablokovaný.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$ language plpgsql security definer;

do $mig$
declare
  tabulka text;
  hotovo text[] := '{}';
begin
  foreach tabulka in array array['videos', 'comments', 'posts'] loop
    if to_regclass('public.' || tabulka) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_reject_banned_%s on %I', tabulka, tabulka);
    execute format(
      'create trigger trg_reject_banned_%s before insert on %I
       for each row execute function reject_if_banned()', tabulka, tabulka);
    hotovo := hotovo || tabulka;
  end loop;

  insert into _migrace_zprava (co, vysledek)
  values ('zakaz zapisu pro zabanovane', array_to_string(hotovo, ', '));
end $mig$;


-- =====================================================================
-- 8. Ať appka nové funkce hned uvidí
-- =====================================================================
-- Supabase si drží seznam funkcí v paměti a novou pozná až po jeho
-- obnovení. Bez tohohle může volání my_account ještě chvíli vracet 404,
-- i když funkce v databázi už je.

notify pgrst, 'reload schema';


-- =====================================================================
-- Souhrn
-- =====================================================================
select co as "co se delo", vysledek as "vysledek"
from _migrace_zprava order by poradi;

-- Ruční kontrola (v SQL editoru běžíš jako správce, takže ta první dvě
-- projdou i tak - v prohlížeči přihlášeného uživatele už ne):
--   select * from my_account();        -> jeden řádek
--   select is_staff();                 -> true u tebe, false u ostatních
--
-- V appce po nasazení kódu:
-- - Statistiky kanálu a stránka moderátora musí fungovat dál.
-- - Shadow ban někomu zapni a odhlas se: jeho videa nesmí být vidět
--   nikde, ale on sám je vidí.
-- - Zabanovaný účet nesmí nahrát video ani napsat komentář.
