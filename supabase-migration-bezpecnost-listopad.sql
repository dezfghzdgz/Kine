-- Spusť CELÉ v Supabase dashboardu -> SQL Editor -> New Query -> Run.
--
-- BEZPEČNOST (listopad 2026) - souhrnná oprava z kontroly databáze
--
-- Stačí pustit JEDNOU, ale dá se pustit i opakovaně (nic se nerozbije ani
-- nezdvojí) a nespadne ani na databázi, kde některá starší (nepovinná)
-- migrace neproběhla - chybějící tabulky a sloupce se jen přeskočí.
-- Pořadí nasazení je jedno; appka funguje před spuštěním i po něm. Patří
-- ke kolu kine-0142, ale je samostatný - nic jiného k němu není potřeba.
--
-- Co to dělá (podrobně u každé části níž):
--   H1  Skryté video (kontrola obsahu) zůstane soukromé i přes "čekající
--       viditelnost" spolupráce - zveřejnit ho může jen moderátor.
--   M1  Komentáře: z prohlížeče nejde podstrčit připnutý / „od tvůrce"
--       komentář, komentovat jde jen pod viditelným videem/příspěvkem
--       (a ne když jsou komentáře vypnuté); číst jen u viditelného obsahu.
--   M2  Pravidla jmen nevěří příznaku výjimky poslanému z prohlížeče.
--   M3  Videa: cizí člověk vidí jen hotová a zveřejněná veřejná videa
--       (ne rozpracovaná ani naplánovaná dopředu). Videa zablokovaných
--       a shadow-banovaných kanálů zmizí všem kromě majitele, spolutvůrců
--       a moderátorů.
--   M4  Úložiště: seznam souborů ve veřejných bucketech si vypíše jen
--       majitel složky (veřejné adresy obrázků fungují dál). Opraveno
--       i nahrávání fotek k příspěvkům (nové názvy souborů).
--   L1  Pomocná funkce o shadow-banu je mimo veřejné schéma (nejde zavolat
--       z prohlížeče).
--   L2  Vlastní náhled videa musí být opravdu z úložiště Kine (ukotvená kontrola).
--   L5  Oznámení z prohlížeče jen za skutečnou akci odesílatele; serverové
--       druhy (dar, živě, odznak…) z prohlížeče neprojdou; anon je nepošle.
--   L6  Historie ratingu, žádosti o ověření a blokování správců - drobné pojistky.
--   +   Nová serverová tabulka download_events (jen server).
--   +   Zhlédnutí bez souběhu, kontrola animovaných emotů moderátorem
--       a indexy pro rychlejší doporučování.


drop table if exists _listopad_zprava;
create temp table _listopad_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 0. Pomocné funkce, na kterých skript stojí (pro jistotu je založí)
-- =====================================================================
-- Kdo volá: server (service role) / SQL editor, nebo člověk z prohlížeče?
-- (Stejná jako v supabase-migration-zabezpeceni-a-limity.sql.)
create or replace function kine_is_server()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'));
$$;
grant execute on function kine_is_server() to anon, authenticated, service_role;

-- Je volající moderátor/admin? (Stejná jako v supabase-migration-privacy-fixes.sql -
-- security definer, aby si roli přečetla i bez práva na sloupec.)
create or replace function is_staff_or_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r boolean;
begin
  select coalesce(p.role in ('moderator','admin'), false) or coalesce(p.is_admin, false)
    into r from profiles p where p.id = auth.uid();
  return coalesce(r, false);
exception when undefined_column or undefined_table then
  return false;
end;
$$;
grant execute on function is_staff_or_admin() to anon, authenticated, service_role;


-- =====================================================================
-- L1. Shadow-ban / skryté kanály: pomocné funkce mimo veřejné schéma
-- =====================================================================
-- Ve veřejném schématu by šly zavolat z prohlížeče (RPC) a vyzradit, kdo je
-- shadow-banovaný. Schéma kine_private se přes API nevystavuje, ale v RLS
-- pravidlech se použít dá. plpgsql + odchycení chyby = nespadne, i když
-- sloupce is_banned / is_shadow_banned v databázi (zatím) nejsou.
create schema if not exists kine_private;
grant usage on schema kine_private to anon, authenticated, service_role;

create or replace function kine_private.owner_is_shadow_banned(owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r boolean;
begin
  select coalesce(p.is_shadow_banned, false) into r from profiles p where p.id = owner;
  return coalesce(r, false);
exception when undefined_column or undefined_table then
  return false;
end;
$$;

create or replace function kine_private.owner_is_hidden(owner uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare r boolean;
begin
  select coalesce(p.is_banned, false) or coalesce(p.is_shadow_banned, false)
    into r from profiles p where p.id = owner;
  return coalesce(r, false);
exception when undefined_column or undefined_table then
  return false;
end;
$$;

-- Rychlejší verze (čisté SQL bez zachytávání chyb - v pravidlech se volá pro
-- každý řádek): jen když sloupce v databázi opravdu jsou.
do $do$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_shadow_banned') then
    execute $f$create or replace function kine_private.owner_is_shadow_banned(owner uuid)
      returns boolean language sql stable security definer set search_path = public, pg_temp as
      $b$ select coalesce((select p.is_shadow_banned from profiles p where p.id = owner), false) $b$$f$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_shadow_banned')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_banned') then
    execute $f$create or replace function kine_private.owner_is_hidden(owner uuid)
      returns boolean language sql stable security definer set search_path = public, pg_temp as
      $b$ select coalesce((select coalesce(p.is_banned, false) or coalesce(p.is_shadow_banned, false) from profiles p where p.id = owner), false) $b$$f$;
  end if;
end $do$;

revoke all on function kine_private.owner_is_shadow_banned(uuid) from public;
revoke all on function kine_private.owner_is_hidden(uuid) from public;
grant execute on function kine_private.owner_is_shadow_banned(uuid) to anon, authenticated, service_role;
grant execute on function kine_private.owner_is_hidden(uuid) to anon, authenticated, service_role;

-- Stará veřejná verze pryč (nahrazena kine_private výše). Nejdřív se níž
-- přepíše pravidlo, které ji používalo, takže na ní už nic nevisí.
-- (drop až po přepsání pravidla - viz část M3.)


-- =====================================================================
-- H1. Skryté video zůstane soukromé i přes "čekající viditelnost"
-- =====================================================================
-- Dřív šlo: autor si u skrytého videa nastavil pending_collab_visibility =
-- 'public', pozval druhý účet a ten pozvánku (ne)přijal - server
-- (service role) pak skryté video zveřejnil. Trigger teď u skrytého videa
-- (moderation_hold) z prohlížeče drží visibility = 'private' a nedovolí
-- změnit pending_collab_visibility. Server (service role, moderátorská
-- cesta app/api/moderation/content a app/api/videos/respond-collab)
-- omezení nemá - hold zakládá i ruší jen on.
--
-- Robustní přes jsonb: když některý sloupec (moderation_*, pending_collab_*)
-- v databázi není, jen se přeskočí - funkce nespadne.
create or replace function protect_video_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stare jsonb;
begin
  if kine_is_server() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Nové video z prohlížeče je vždy nezkontrolované (výsledek dává jen server).
    new := jsonb_populate_record(new, jsonb_build_object(
      'moderation_checked_at', null,
      'moderation_reason', null,
      'moderation_hold', null,
      'moderation_prev_visibility', null
    ));
    return new;
  end if;

  stare := to_jsonb(old);

  -- Výsledek kontroly mění jen server - z prohlížeče se vrátí původní hodnoty.
  new := jsonb_populate_record(new, jsonb_build_object(
    'moderation_checked_at', stare -> 'moderation_checked_at',
    'moderation_reason', stare -> 'moderation_reason',
    'moderation_hold', stare -> 'moderation_hold',
    'moderation_prev_visibility', stare -> 'moderation_prev_visibility'
  ));

  -- Dokud je video skryté kontrolou, zůstane soukromé a čekající viditelnost
  -- (spolupráce) se z prohlížeče nedá nastavit - jinak by ji server při
  -- odpovědi na pozvánku vrátil do visibility.
  if (stare ->> 'moderation_hold') is not null then
    new := jsonb_populate_record(new, jsonb_build_object(
      'visibility', 'private',
      'pending_collab_visibility', stare -> 'pending_collab_visibility'
    ));
  end if;

  -- Nový vlastní náhled = znovu zkontrolovat.
  if (to_jsonb(new) ->> 'thumbnail_url') is distinct from (stare ->> 'thumbnail_url') then
    new := jsonb_populate_record(new, jsonb_build_object('moderation_checked_at', null));
  end if;

  return new;
end;
$$;

do $do$
begin
  if to_regclass('public.videos') is null then
    insert into _listopad_zprava (co, vysledek) values ('H1 ochrana skrytých videí', 'tabulka videos neexistuje, preskoceno');
    return;
  end if;
  execute 'drop trigger if exists trg_protect_video_moderation on videos';
  execute 'create trigger trg_protect_video_moderation before insert or update on videos
           for each row execute function protect_video_moderation()';
  -- Jednorázově: cokoliv je teď skryté (hold), ať je opravdu soukromé.
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='moderation_hold') then
    execute $u$update videos set visibility = 'private' where moderation_hold is not null and visibility is distinct from 'private'$u$;
  end if;
  insert into _listopad_zprava (co, vysledek) values ('H1 skryté video zůstane soukromé (trigger + srovnání)', 'zapnuto');
end $do$;


-- =====================================================================
-- M3. Videa: jen hotová a zveřejněná veřejná videa cizím + skrytí kanálů
-- =====================================================================
-- Dřív si cizí člověk mohl z prohlížeče vypsat i rozpracovaná a dopředu
-- naplánovaná videa (a z cloudflare_video_id si je pustit). Nová politika:
-- majitel a (po)zvaný spolutvůrce vidí vždy; ostatní jen status='ready'
-- a zveřejněné (scheduled_at prošlo, nebo premiéra kvůli odpočtu) a jen
-- public / pro odběratele.
do $do$
declare
  has_sched boolean;
  has_prem boolean;
  has_status boolean;
  has_vis boolean;
  has_collab boolean := to_regclass('public.video_collaborators') is not null;
  has_subs boolean := to_regclass('public.subscriptions') is not null;
  pol record;
  rel text;
  branch_public text;
  collab_sql text := 'false';
begin
  if to_regclass('public.videos') is null then
    insert into _listopad_zprava (co, vysledek) values ('M3 viditelnost videí', 'tabulka videos neexistuje, preskoceno');
    return;
  end if;
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='scheduled_at') into has_sched;
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='is_premiere') into has_prem;
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='status') into has_status;
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='visibility') into has_vis;

  -- "zveřejněno": bez sloupce scheduled_at bereme vše jako zveřejněné.
  rel := case
    when has_sched and has_prem then '(scheduled_at is null or scheduled_at <= now() or coalesce(is_premiere, false))'
    when has_sched then '(scheduled_at is null or scheduled_at <= now())'
    else 'true' end;

  if has_vis then
    branch_public := '(visibility = ''public''';
    if has_subs then
      branch_public := branch_public || ' or (visibility = ''subscribers'' and exists (select 1 from subscriptions s where s.channel_id = videos.owner_id and s.subscriber_id = (select auth.uid())))';
    end if;
    branch_public := branch_public || ')';
  else
    branch_public := 'true';
  end if;

  if has_collab then
    collab_sql := 'exists (select 1 from video_collaborators c where c.video_id = videos.id and c.profile_id = (select auth.uid()))';
  end if;

  execute 'drop policy if exists "Videa jsou viditelná podle nastavení soukromí" on videos';
  -- Kdyby zůstalo staré "vidí každý všechno" (using true) - třeba po opakovaném
  -- spuštění supabase-schema.sql - pryč s ním, jinak by nové pravidlo nic nezměnilo.
  execute 'drop policy if exists "Videa jsou veřejně viditelná" on videos';
  for pol in select policyname from pg_policies where schemaname='public' and tablename='videos' and cmd in ('SELECT','ALL') and coalesce(qual,'') = 'true' loop
    execute format('drop policy %I on videos', pol.policyname);
  end loop;
  execute format($p$
    create policy "Videa jsou viditelná podle nastavení soukromí" on videos for select
    using (
      owner_id = (select auth.uid())
      or %s
      or ( %s and %s and %s )
    )$p$,
    collab_sql,
    case when has_status then 'status = ''ready''' else 'true' end,
    rel,
    branch_public
  );

  -- Skryté kanály (zablokované i shadow-banované): videa zmizí všem kromě
  -- majitele, spolutvůrců a moderátorů/správců. "as restrictive" = přidá se
  -- jako další podmínka (A ZÁROVEŇ), ne jako další povolená cesta.
  execute 'drop policy if exists "Shadow ban schová videa ostatním" on videos';
  execute 'drop policy if exists "Skryté kanály schovají videa ostatním" on videos';
  execute format($p$
    create policy "Skryté kanály schovají videa ostatním" on videos
      as restrictive for select
      using (
        owner_id = (select auth.uid())
        or not kine_private.owner_is_hidden(owner_id)
        or %s
        or (select public.is_staff_or_admin())
      )$p$, collab_sql);

  insert into _listopad_zprava (co, vysledek) values ('M3 viditelnost videí + skrytí zablokovaných kanálů', 'zapnuto');
end $do$;

-- Teď, když už pravidlo nepoužívá veřejnou owner_is_shadow_banned, ji zrušíme (L1).
-- Nejdřív sebereme právo volat ji z prohlížeče (kdyby ji nešlo smazat kvůli
-- nějaké další závislosti, aspoň nebude přes RPC dostupná), pak zkusíme drop.
do $do$
begin
  if to_regprocedure('public.owner_is_shadow_banned(uuid)') is not null then
    begin
      execute 'revoke all on function public.owner_is_shadow_banned(uuid) from public, anon, authenticated';
    exception when others then null; end;
    begin
      execute 'drop function public.owner_is_shadow_banned(uuid)';
    exception when dependent_objects_still_exist then
      null; -- něco na ní ještě visí; zůstane, ale z prohlížeče už nejde zavolat
    end;
  end if;
end $do$;


-- =====================================================================
-- M1. Komentáře: bezpečný zápis i čtení
-- =====================================================================
-- INSERT: nejde z prohlížeče nastavit pinned ani hearted_by_creator (to umí
--   jen vlastník videa přes UPDATE), komentovat jen pod obsahem, který
--   volající vidí, a ne když má video vypnuté komentáře.
-- SELECT: komentáře jen u viditelného videa/příspěvku (dřív šly vypsat
--   i komentáře u soukromých/nezveřejněných videí).
do $do$
declare
  pol record;
  has_post_id boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='comments' and column_name='post_id');
  has_posts boolean := to_regclass('public.posts') is not null;
  has_cd boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='comments_disabled');
  has_pinned boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='comments' and column_name='pinned');
  has_heart boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='comments' and column_name='hearted_by_creator');
  post_visible text;
  video_visible text;
  sel_expr text;
  ins_expr text;
begin
  if to_regclass('public.comments') is null then
    insert into _listopad_zprava (co, vysledek) values ('M1 komentáře', 'tabulka comments neexistuje, preskoceno');
    return;
  end if;

  post_visible := case when (has_post_id and has_posts)
    then 'exists (select 1 from posts p where p.id = comments.post_id)' else 'false' end;
  video_visible := 'exists (select 1 from videos v where v.id = comments.video_id)';

  -- Čtení: u komentáře k příspěvku rozhoduje viditelnost příspěvku (členské
  -- příspěvky řeší jeho vlastní politika), u komentáře k videu viditelnost videa.
  if has_post_id then
    sel_expr := format('(case when post_id is not null then %s else %s end)', post_visible, video_visible);
  else
    sel_expr := video_visible;
  end if;

  -- Zápis: jen pod viditelným obsahem; u videa navíc jen když nejsou vypnuté komentáře.
  if has_post_id then
    ins_expr := format('(case when post_id is not null then %s else (%s%s) end)',
      post_visible,
      'exists (select 1 from videos v where v.id = comments.video_id',
      case when has_cd then ' and not coalesce(v.comments_disabled, false))' else ')' end);
  else
    ins_expr := format('%s%s',
      'exists (select 1 from videos v where v.id = comments.video_id',
      case when has_cd then ' and not coalesce(v.comments_disabled, false))' else ')' end);
  end if;

  -- Všechna dosavadní čtecí a vkládací pravidla komentářů pryč (i kdyby zůstalo
  -- staré "vidí/píše každý" pod jiným názvem) - nahradí je bezpečná níž.
  for pol in select policyname from pg_policies where schemaname='public' and tablename='comments' and cmd in ('SELECT','INSERT') loop
    execute format('drop policy %I on comments', pol.policyname);
  end loop;

  execute format('create policy "Komentáře čte jen kdo vidí obsah" on comments for select using (%s)', sel_expr);

  execute format($p$create policy "Komentuje přihlášený jen pod viditelným obsahem" on comments for insert to authenticated
    with check (auth.uid() = user_id%s%s and %s)$p$,
    case when has_pinned then ' and not coalesce(pinned, false)' else '' end,
    case when has_heart then ' and not coalesce(hearted_by_creator, false)' else '' end,
    ins_expr);

  insert into _listopad_zprava (co, vysledek) values ('M1 komentáře: bezpečný zápis i čtení', 'zapnuto');
end $do$;


-- =====================================================================
-- M2. Pravidla jmen nevěří příznaku výjimky z prohlížeče
-- =====================================================================
-- Dřív trigger věřil new.username_exempt - útočník si ho poslal spolu se
-- jménem (druhý trigger ho sice vrátil zpátky, ale až po kontrole jména).
-- Teď se výjimka bere jen z databáze (stará hodnota), nikdy z toho, co
-- přišlo z prohlížeče, a server má bez omezení.
create or replace function enforce_username_rules()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;
  if kine_is_server() then
    return new;
  end if;
  -- Výjimku bere jen podle uložené (staré) hodnoty - ne podle NEW.
  if tg_op = 'UPDATE' and coalesce(old.username_exempt, false) then
    return new;
  end if;
  if not username_is_valid(new.username) then
    raise exception 'Neplatné uživatelské jméno: %', coalesce(new.username, '(prázdné)')
      using errcode = 'check_violation',
            hint = '3 az 20 znaku, jen pismena bez diakritiky, cislice, tecka a podtrzitko. Na zacatku a na konci pismeno nebo cislice.';
  end if;
  return new;
end;
$$;

do $do$
begin
  if to_regclass('public.profiles') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='username_exempt')
     and to_regprocedure('public.username_is_valid(text)') is not null then
    execute 'drop trigger if exists trg_enforce_username_rules on profiles';
    execute 'create trigger trg_enforce_username_rules before insert or update on profiles
             for each row execute function enforce_username_rules()';
    insert into _listopad_zprava (co, vysledek) values ('M2 pravidla jmen nevěří NEW.username_exempt', 'zapnuto');
  else
    insert into _listopad_zprava (co, vysledek) values ('M2 pravidla jmen', 'chybi username_is_valid / username_exempt, preskoceno');
  end if;
end $do$;


-- =====================================================================
-- L2. Vlastní náhled videa musí být opravdu z úložiště Kine
-- =====================================================================
-- Dřív se adresa náhledu hledala kdekoli v řetězci (position(... in ...)),
-- takže https://zlo.cz/?/storage/v1/object/public/thumbnails/<id>/ prošlo
-- a server si ho pak stáhl ke kontrole. Teď musí cesta ZAČÍNAT naší veřejnou
-- adresou úložiště a složkou vlastníka (ukotveno regulárním výrazem).
-- Seznam generovaných sloupců se počítá rovnou tady (bez pomocné funkce
-- kine_generated_columns), aby funkce fungovala i tam, kde ta pomocná není.
create or replace function kine_guard_video()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  gen text[];
  stare jsonb;
  nove jsonb;
begin
  if kine_is_server() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Video ukládá jen server.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(attname::text), '{}'::text[]) into gen
    from pg_attribute where attrelid = tg_relid and attnum > 0 and not attisdropped and attgenerated <> '';
  stare := to_jsonb(old) - gen;
  nove := to_jsonb(new) - gen;

  -- Cizí video (moderátor): jen vypnout / zapnout komentáře.
  if ja is null or ja <> old.owner_id then
    new := jsonb_populate_record(new, stare || jsonb_build_object('comments_disabled', nove -> 'comments_disabled'));
    return new;
  end if;

  if (nove ->> 'title') is distinct from (stare ->> 'title')
     and (char_length(coalesce(nove ->> 'title', '')) > 150 or btrim(coalesce(nove ->> 'title', '')) = '') then
    raise exception 'Název videa: 1 až 150 znaků.' using errcode = 'check_violation';
  end if;
  if (nove ->> 'description') is distinct from (stare ->> 'description') and char_length(coalesce(nove ->> 'description', '')) > 5000 then
    raise exception 'Popis je příliš dlouhý (max 5000 znaků).' using errcode = 'check_violation';
  end if;
  if (nove -> 'chapters') is distinct from (stare -> 'chapters') and char_length(coalesce((nove -> 'chapters')::text, '')) > 50000 then
    raise exception 'Kapitol je moc.' using errcode = 'check_violation';
  end if;
  if (nove -> 'captions') is distinct from (stare -> 'captions') and char_length(coalesce((nove -> 'captions')::text, '')) > 600000 then
    raise exception 'Titulky jsou moc dlouhé.' using errcode = 'check_violation';
  end if;
  -- Vlastní náhled jen z vlastní složky v úložišti Kine - cesta musí ZAČÍNAT
  -- naší veřejnou adresou úložiště a složkou vlastníka (ne jen ji někde obsahovat).
  if (nove ->> 'thumbnail_url') is distinct from (stare ->> 'thumbnail_url') and (nove ->> 'thumbnail_url') is not null
     and ( char_length(nove ->> 'thumbnail_url') > 600
        or (nove ->> 'thumbnail_url') !~ ('^https://[a-z0-9.-]+/storage/v1/object/public/thumbnails/' || old.owner_id::text || '/') ) then
    raise exception 'Náhled musí být obrázek nahraný na Kine.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $do$
begin
  if to_regclass('public.videos') is not null then
    execute 'drop trigger if exists trg_kine_guard_video on videos';
    execute 'create trigger trg_kine_guard_video before insert or update on videos
             for each row execute function kine_guard_video()';
    insert into _listopad_zprava (co, vysledek) values ('L2 ukotvená kontrola adresy náhledu', 'zapnuto');
  else
    insert into _listopad_zprava (co, vysledek) values ('L2 kontrola náhledu', 'tabulka videos neexistuje, preskoceno');
  end if;
end $do$;


-- =====================================================================
-- L5. Oznámení z prohlížeče jen za skutečnou akci odesílatele
-- =====================================================================
-- - anon oznámení nepošle (dřív se guard přeskočil, když bylo auth.uid() null),
-- - serverové druhy (dar, živě, nové video/příspěvek, milník zhlédnutí,
--   odznak) z prohlížeče neprojdou,
-- - druhy, které posílá appka po akci, musí mít tu akci opravdu za sebou
--   (odběr -> řádek odběru, odpověď -> komentář, milník lajků -> hodnocení),
--   jinak se oznámení potichu zahodí (appka nespadne),
-- - moderátorské upozornění jen od moderátora, pozvánka jen k vlastnímu videu.
create or replace function notifications_client_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  za_minutu int := 0;
  za_hodinu int := 0;
  jednomu int := 0;
  je_moderator boolean := false;
  ma_podklad boolean := false;
begin
  -- Server (service role) i SQL editor: bez omezení.
  if kine_is_server() then
    return new;
  end if;
  -- Z prohlížeče jen přihlášený (anon se sem nedostane, i kdyby se omylem
  -- obnovila stará otevřená politika pro zápis).
  if ja is null then
    raise exception 'Oznámení posílá jen přihlášený.' using errcode = 'insufficient_privilege';
  end if;

  new.sender_id := ja;
  new.created_at := now();
  new.read := false;
  new.type := coalesce(new.type, 'default');

  -- Druhy, které z prohlížeče poslat nejde vůbec (zakládá jen server).
  if new.type not in ('default', 'collab_invite', 'comment_reply', 'like_milestone', 'subscription', 'moderation_warning') then
    raise exception 'Tenhle druh oznámení posílá jen Kine.' using errcode = 'insufficient_privilege';
  end if;

  -- Obecné oznámení jen sám sobě.
  if new.type = 'default' and new.user_id is distinct from ja then
    raise exception 'Obecné oznámení jde poslat jen sobě.' using errcode = 'insufficient_privilege';
  end if;

  -- Upozornění od moderátora jen od moderátora/správce.
  if new.type = 'moderation_warning' then
    begin
      select coalesce(p.role in ('moderator','admin'), false) or coalesce(p.is_admin, false)
        into je_moderator from profiles p where p.id = ja;
    exception when others then je_moderator := false; end;
    if not coalesce(je_moderator, false) then
      raise exception 'Upozornění od moderátora posílá jen moderátor.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Pozvánka ke spolupráci: jen k vlastnímu videu, kam je příjemce opravdu pozvaný.
  if new.type = 'collab_invite' then
    begin
      ma_podklad := exists (
        select 1 from video_collaborators vc
        join videos v on v.id = vc.video_id
        where vc.profile_id = new.user_id and v.owner_id = ja
          and new.link = '/watch/' || vc.video_id::text
      );
    exception when others then ma_podklad := false; end;
    if not ma_podklad then
      raise exception 'Pozvánka ke spolupráci jde poslat jen k vlastnímu videu.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Druhy s podkladem: bez skutečné akce se oznámení potichu zahodí.
  if new.type in ('subscription', 'like_milestone', 'comment_reply') then
    begin
      if new.type = 'subscription' then
        ma_podklad := exists (select 1 from subscriptions s where s.subscriber_id = ja and s.channel_id = new.user_id);
      elsif new.type = 'like_milestone' then
        ma_podklad := exists (
          select 1 from video_reactions r join videos v on v.id = r.video_id
           where r.user_id = ja and v.owner_id = new.user_id and coalesce(r.score, 0) >= 4
        );
      else -- comment_reply
        ma_podklad := exists (
          select 1 from comments c
           where c.user_id = ja and c.created_at > now() - interval '30 minutes'
             and ( exists (select 1 from videos v where v.id = c.video_id and v.owner_id = new.user_id)
                or exists (select 1 from comments pc where pc.id = c.parent_id and pc.user_id = new.user_id) )
        );
      end if;
    exception when others then ma_podklad := false; end;
    if not ma_podklad then
      return null; -- bez podkladu oznámení potichu neuložíme (appka nespadne)
    end if;
  end if;

  if char_length(coalesce(new.message, '')) > 400 then
    raise exception 'Oznámení je moc dlouhé.' using errcode = 'check_violation';
  end if;

  select count(*) filter (where n.created_at > now() - interval '1 minute'),
         count(*),
         count(*) filter (where n.user_id = new.user_id)
    into za_minutu, za_hodinu, jednomu
    from notifications n
   where n.sender_id = ja
     and n.created_at > now() - interval '1 hour';

  if za_minutu >= 20 or za_hodinu >= 200 or jednomu >= 15 then
    if new.type = 'collab_invite' then
      raise exception 'Moc rychle - zkus to prosím za chvíli.' using errcode = 'KN429';
    end if;
    return null;
  end if;

  return new;
end;
$$;

do $do$
declare
  pol record;
begin
  if to_regclass('public.notifications') is null then
    insert into _listopad_zprava (co, vysledek) values ('L5 oznámení', 'tabulka notifications neexistuje, preskoceno');
    return;
  end if;
  -- sender_id musí existovat (zakládá supabase-migration-bezpecnost-rijen.sql).
  execute 'alter table notifications add column if not exists sender_id uuid references profiles(id) on delete set null';
  execute 'drop trigger if exists trg_notifications_client_guard on notifications';
  execute 'create trigger trg_notifications_client_guard before insert on notifications
           for each row execute function notifications_client_guard()';
  -- Zápisová politika: jen přihlášený pod svým jménem (i kdyby zůstala stará "true").
  for pol in select policyname from pg_policies where schemaname='public' and tablename='notifications' and cmd='INSERT' loop
    execute format('drop policy %I on notifications', pol.policyname);
  end loop;
  execute 'create policy "Přihlášený posílá oznámení pod svým jménem" on notifications
             for insert to authenticated
             with check (auth.uid() is not null and sender_id = auth.uid())';
  insert into _listopad_zprava (co, vysledek) values ('L5 oznámení: anon blokován, druhy s podkladem', 'zapnuto');
end $do$;


-- =====================================================================
-- M4. Úložiště: seznam souborů jen vlastníkovi; oprava nahrávání fotek
-- =====================================================================
-- Veřejné buckety servírují obrázky přes veřejnou adresu bez ohledu na RLS,
-- takže getPublicUrl funguje dál. Čtecí (SELECT) pravidlo ale pouští výpis
-- souborů (list) komukoli - tím šlo projít cizí náhledy soukromých videí
-- i fotky z členských příspěvků. Nahradíme ho výpisem jen vlastní složky.
do $do$
declare
  pol record;
  b text;
  nase constant text[] := array['avatars','banners','thumbnails','post-images','comment-images','playlist-covers','playlist-thumbnails'];
begin
  if to_regclass('storage.objects') is null then
    insert into _listopad_zprava (co, vysledek) values ('M4 úložiště', 'schema storage neni, preskoceno');
    return;
  end if;

  -- Pryč stará úplně otevřená pravidla "for all" (dřívější playlisty).
  execute 'drop policy if exists "playlist_covers_all" on storage.objects';
  execute 'drop policy if exists "playlist_thumbnails_all" on storage.objects';
  execute 'drop policy if exists "playlist_thumbnails_all_v4" on storage.objects';

  -- Všechna čtecí pravidla, která zpřístupňují naše buckety komukoli, pryč.
  for pol in
    select policyname, coalesce(qual,'') as q from pg_policies
     where schemaname='storage' and tablename='objects' and cmd = 'SELECT'
  loop
    if exists (select 1 from unnest(nase) x where position('''' || x || '''' in pol.q) > 0) then
      execute format('drop policy %I on storage.objects', pol.policyname);
    end if;
  end loop;

  -- Nové čtení: jen vlastní složka. (Zobrazení obrázků jde přes veřejnou adresu.)
  foreach b in array nase loop
    execute format('drop policy if exists %I on storage.objects', 'kine_' || b || '_read');
    execute format($p$create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$p$, 'kine_' || b || '_read', b);
  end loop;

  -- Obálky playlistů: jistota, že zápis (i upsert) funguje jen do vlastní složky.
  execute 'drop policy if exists "kine_playlist_covers_insert" on storage.objects';
  execute $p$create policy "kine_playlist_covers_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists "kine_playlist_covers_update" on storage.objects';
  execute $p$create policy "kine_playlist_covers_update" on storage.objects for update to authenticated
    using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute 'drop policy if exists "kine_playlist_covers_delete" on storage.objects';
  execute $p$create policy "kine_playlist_covers_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = auth.uid()::text)$p$;

  insert into _listopad_zprava (co, vysledek) values ('M4 úložiště: výpis jen vlastní složky', 'zapnuto');
end $do$;

-- Oprava nahrávání fotek k příspěvkům: appka teď pojmenovává soubory náhodně
-- (crypto.randomUUID - components/PostComposer.tsx), což stará přísná politika
-- (jen číslice) odmítala -> fotky k příspěvkům vůbec nešlo nahrát. Přepíšeme
-- pravidlo na vlastní složka + obrázek (denní strop, když je funkce). Stejná
-- oprava je i v supabase-migration-zabezpeceni-a-limity.sql (kvůli opakování).
do $do$
declare
  has_cap boolean := to_regprocedure('public.kine_storage_recent_uploads(text)') is not null;
  check_sql text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  check_sql := 'bucket_id = ''post-images'' and name ~* (''^'' || auth.uid()::text || ''/[A-Za-z0-9._-]{1,80}\.(jpg|jpeg|png|webp|gif|avif)$'')';
  if has_cap then
    check_sql := check_sql || ' and public.kine_storage_recent_uploads(''post-images'') < 60';
  end if;
  execute 'drop policy if exists "kine_post_images_insert" on storage.objects';
  execute 'drop policy if exists "kine_post_images_insert_v2" on storage.objects';
  execute format('create policy "kine_post_images_insert" on storage.objects for insert to authenticated with check (%s)', check_sql);
  insert into _listopad_zprava (co, vysledek) values ('M4 fotky příspěvků: nahrávání opraveno (náhodné názvy)', 'zapnuto');
end $do$;


-- =====================================================================
-- Playlisty: soukromé vidí jen majitel (pro jistotu, kdyby se vrátilo
-- staré "vidí každý" po opakovaném spuštění starších souborů)
-- =====================================================================
do $do$
declare
  pol record;
  has_vis boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='playlists' and column_name='visibility');
begin
  if to_regclass('public.playlists') is null or not has_vis then
    insert into _listopad_zprava (co, vysledek) values ('playlisty: soukromí', 'bez sloupce visibility, preskoceno');
    return;
  end if;
  for pol in select policyname from pg_policies where schemaname='public' and tablename='playlists' and cmd in ('SELECT','ALL') and coalesce(qual,'')='true' loop
    execute format('drop policy %I on playlists', pol.policyname);
  end loop;
  execute 'drop policy if exists "Playlist vidí majitel, veřejný každý" on playlists';
  execute $p$create policy "Playlist vidí majitel, veřejný každý" on playlists for select
             using (visibility = 'public' or owner_id = auth.uid())$p$;

  if to_regclass('public.playlist_videos') is not null then
    for pol in select policyname from pg_policies where schemaname='public' and tablename='playlist_videos' and cmd in ('SELECT','ALL') and coalesce(qual,'')='true' loop
      execute format('drop policy %I on playlist_videos', pol.policyname);
    end loop;
    execute 'drop policy if exists "Obsah playlistu vidí, kdo vidí playlist" on playlist_videos';
    execute $p$create policy "Obsah playlistu vidí, kdo vidí playlist" on playlist_videos for select
               using (exists (select 1 from playlists p where p.id = playlist_videos.playlist_id and (p.visibility = 'public' or p.owner_id = auth.uid())))$p$;
  end if;
  insert into _listopad_zprava (co, vysledek) values ('playlisty: soukromé vidí jen majitel', 'zapnuto');
end $do$;


-- =====================================================================
-- Profily: zavřít serverové sloupce přidané později (po privacy-fixes)
-- =====================================================================
-- supabase-migration-privacy-fixes.sql zavřela citlivé sloupce profilu, ale
-- neznala sloupce, které přibyly potom (Stripe předplatné, poznámka k plánu,
-- „o odznaku už vím"). Appka je z prohlížeče nečte (jen server), tak je
-- zavřeme i tady. (V privacy-fixes jsou nově v seznamu citlivých, aby se při
-- opakovaném spuštění znovu neotevřely.)
do $do$
declare
  c text;
  citlive text[] := array['plan_stripe_subscription_id', 'plan_stripe_customer_id', 'plan_note', 'badges_seen'];
  zavreno text[] := '{}';
begin
  if to_regclass('public.profiles') is null then
    insert into _listopad_zprava (co, vysledek) values ('profiles: serverové sloupce', 'tabulka profiles neexistuje, preskoceno');
    return;
  end if;
  foreach c in array citlive loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name=c) then
      execute format('revoke select (%I) on profiles from anon, authenticated', c);
      zavreno := zavreno || c;
    end if;
  end loop;
  insert into _listopad_zprava (co, vysledek)
  values ('profiles: zavřené serverové sloupce z prohlížeče', coalesce(nullif(array_to_string(zavreno, ', '), ''), '(zadne)'));
end $do$;


-- =====================================================================
-- L6. Drobné pojistky
-- =====================================================================
-- a) Historie ratingu: rozumný rozsah skóre (ať si nikdo nenafoukne graf).
do $do$
begin
  if to_regclass('public.trust_rating_snapshots') is not null then
    execute 'alter table trust_rating_snapshots drop constraint if exists trust_rating_snapshots_score_range';
    execute 'alter table trust_rating_snapshots add constraint trust_rating_snapshots_score_range check (score between 0 and 100) not valid';
    insert into _listopad_zprava (co, vysledek) values ('L6 rating: rozsah skóre 0-100', 'zapnuto');
  end if;
end $do$;

-- b) Žádost o ověření: stav a čas vyřízení nastavuje jen server.
create or replace function kine_guard_verification_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if kine_is_server() then
    return new;
  end if;
  new.status := 'pending';
  new.reviewed_at := null;
  if new.user_id is distinct from auth.uid() then
    raise exception 'Žádost o ověření jde podat jen sám za sebe.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

do $do$
begin
  if to_regclass('public.verification_requests') is not null then
    execute 'drop trigger if exists trg_kine_guard_verification_request on verification_requests';
    execute 'create trigger trg_kine_guard_verification_request before insert or update on verification_requests
             for each row execute function kine_guard_verification_request()';
    insert into _listopad_zprava (co, vysledek) values ('L6 žádost o ověření: stav jen server', 'zapnuto');
  end if;
end $do$;

-- c) Moderátor nesmí zablokovat / přeřadit správce. Trigger běží JAKO POSLEDNÍ
--    (jméno trg_zz_*), takže má poslední slovo nad is_banned/role atd.
create or replace function kine_protect_staff_targets()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cil_admin boolean := false;
  ja_admin boolean := false;
begin
  if kine_is_server() or auth.uid() is null then
    return new;
  end if;
  begin
    cil_admin := coalesce(old.is_admin, false) or coalesce(old.role, 'user') = 'admin';
    select coalesce(p.is_admin, false) or coalesce(p.role, 'user') = 'admin' into ja_admin from profiles p where p.id = auth.uid();
  exception when undefined_column then
    return new;
  end;
  if coalesce(cil_admin, false) and not coalesce(ja_admin, false) then
    new.is_banned := old.is_banned;
    new.is_shadow_banned := old.is_shadow_banned;
    new.payouts_suspended := old.payouts_suspended;
    new.role := old.role;
  end if;
  return new;
end;
$$;

do $do$
declare
  pocet int;
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;
  select count(*) into pocet from information_schema.columns
   where table_schema='public' and table_name='profiles'
     and column_name in ('role', 'is_banned', 'is_shadow_banned', 'payouts_suspended');
  if pocet = 4 then
    execute 'drop trigger if exists trg_zz_protect_staff_targets on profiles';
    execute 'create trigger trg_zz_protect_staff_targets before update on profiles
             for each row execute function kine_protect_staff_targets()';
    insert into _listopad_zprava (co, vysledek) values ('L6 moderátor nezablokuje správce', 'zapnuto');
  else
    insert into _listopad_zprava (co, vysledek) values ('L6 ochrana správců', 'chybi sloupce role/is_banned/..., preskoceno');
  end if;
end $do$;


-- =====================================================================
-- Nová serverová tabulka: download_events (jen server)
-- =====================================================================
-- Záznam stažení videa. Čte a zapisuje jen server (service role) - RLS
-- zapnuté a žádná politika, z prohlížeče se k ní nedostane nikdo.
create table if not exists download_events (
  id bigserial primary key,
  user_id uuid not null,
  video_id uuid,
  created_at timestamptz not null default now()
);
alter table download_events enable row level security;
revoke all on download_events from anon, authenticated;
grant all on download_events to service_role;
create index if not exists download_events_user_created_idx on download_events (user_id, created_at desc);


-- =====================================================================
-- Zhlédnutí bez souběhu (app/api/videos/increment-view)
-- =====================================================================
-- Server se dřív nejdřív ptal "počítal jsem odsud tohle video za poslední
-- půlhodinu?" a teprve pak zapsal - víc požadavků naráz ze stejné adresy
-- prošlo všechny a každý přičetl zhlédnutí. S jedinečným klíčem (video,
-- adresa, půlhodina) zapíše a přičte zhlédnutí jen jeden z nich. Staré řádky
-- mají view_slot prázdný a s klíčem nekolidují. Bez tohohle web funguje postaru.
do $do$
begin
  if to_regclass('public.views_log') is null
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='views_log' and column_name='ip_address') then
    insert into _listopad_zprava (co, vysledek) values ('zhlédnutí bez souběhu', 'views_log / ip_address chybi, preskoceno');
    return;
  end if;
  execute 'alter table views_log add column if not exists view_slot integer';
  execute 'create unique index if not exists views_log_dedupe_idx on views_log (video_id, ip_address, view_slot)';
  insert into _listopad_zprava (co, vysledek) values ('zhlédnutí bez souběhu (video + adresa + půlhodina)', 'zapnuto');
end $do$;


-- =====================================================================
-- Kontrola emotů, které server sám nepřečte (animované GIF / WebP)
-- =====================================================================
-- Statický emote server zkontroluje sám (rozbalí PNG a projede kontrolou
-- nahoty). Animovaný GIF / WebP přečíst neumí - takový emote čeká na
-- moderátora (fronta Kontrola obsahu v /reports) a v chatu se ukáže až po
-- schválení. Bez tohohle jdou nahrát jen statické emoty.
do $do$
begin
  if to_regclass('public.channel_emotes') is null then
    insert into _listopad_zprava (co, vysledek) values ('kontrola emotů', 'tabulka channel_emotes neexistuje, preskoceno');
    return;
  end if;
  execute 'alter table channel_emotes add column if not exists review_status text not null default ''approved''';
  execute 'alter table channel_emotes drop constraint if exists channel_emotes_review_status_check';
  execute 'alter table channel_emotes add constraint channel_emotes_review_status_check check (review_status in (''pending'', ''approved''))';
  execute 'create index if not exists channel_emotes_pending_idx on channel_emotes (created_at) where review_status = ''pending''';
  -- Neschválený emote nejde číst ani přímo přes Supabase (chat i správa emotů jdou přes server).
  execute 'drop policy if exists "Emoty kanálů jsou veřejné" on channel_emotes';
  execute 'create policy "Emoty kanálů jsou veřejné" on channel_emotes for select using (review_status = ''approved'')';
  insert into _listopad_zprava (co, vysledek) values ('kontrola emotů: animované čekají na moderátora', 'zapnuto');
end $do$;


-- =====================================================================
-- Indexy pro doporučování (rychlejší hlavní stránka, Sparks, Explore)
-- =====================================================================
-- Nic nemění na chování - jen zrychlí nové dotazy seznamů videí.
do $do$
declare
  has_core boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='status')
                  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='visibility');
  has_dims boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='width')
                  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='height')
                  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='duration_seconds');
  has_sched boolean := exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='scheduled_at');
begin
  if to_regclass('public.videos') is null or not has_core then
    insert into _listopad_zprava (co, vysledek) values ('indexy doporučování', 'chybi sloupce status/visibility, preskoceno');
    return;
  end if;
  execute 'create index if not exists idx_videos_feed_timeline on videos (created_at desc, id) where status = ''ready'' and visibility = ''public''';
  if has_dims then
    execute 'create index if not exists idx_videos_sparks_timeline on videos (created_at desc, id)
             where status = ''ready'' and visibility = ''public'' and width is not null and height is not null
               and (duration_seconds is null or duration_seconds <= 120)';
    execute 'create index if not exists idx_videos_sparks_popular on videos (views desc, created_at desc)
             where status = ''ready'' and visibility = ''public'' and width is not null and height is not null
               and (duration_seconds is null or duration_seconds <= 120)';
  end if;
  if has_sched then
    execute 'create index if not exists idx_videos_scheduled_release on videos (scheduled_at desc)
             where status = ''ready'' and visibility = ''public'' and scheduled_at is not null';
  end if;
  insert into _listopad_zprava (co, vysledek) values ('indexy doporučování', 'hotovo');
end $do$;


-- Ať Supabase nové funkce a tabulky hned uvidí.
notify pgrst, 'reload schema';


-- =====================================================================
-- Souhrn
-- =====================================================================
select co as "co se delo", vysledek as "vysledek" from _listopad_zprava order by poradi;
