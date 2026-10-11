-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- BEZPEČNOST (říjen 2026)
--
-- Vyšlo to z kontroly celé databáze a všech 42 API cest. Skript se dá pustit
-- opakovaně a nespadne ani na databázi, kde některá starší migrace chybí
-- (takovou část jen přeskočí). Na konci vypíše tabulku s tím, co udělal.
--
-- Patří k němu úprava kódu ze stejné dodávky - pořadí nasazení je jedno,
-- appka funguje před spuštěním i po něm.
--
--   1. Oznámení: cizí člověk už nepošle odkaz ven z Kine, nemůže se vydávat
--      za moderátora ani za server a nemůže nikoho zasypat oznámeními.
--   2. Ankety: hlasuje se přes funkci - nikdo už nepřepíše cizí příspěvek.
--   3. Komentáře, hlášení a odběry mají strop rychlosti, komentář strop délky.
--      Majitel videa už nepřepíše cizí komentář (jen připne / dá srdíčko).
--   4. Video: odkaz na soubor u Cloudflare a stav zpracování mění jen server.
--   5. Funkce s právy správce mají pevnou search_path.
--   6. Sloupce pro vysílání z appky (pokud ještě nejsou).


-- Zápisník, ze kterého se na konci vypíše souhrn.
drop table if exists _migrace_zprava;
create temp table _migrace_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 1. Oznámení
-- =====================================================================
-- Dřív platilo "for insert with check (true)": kdokoli přihlášený mohl
-- z konzole prohlížeče poslat komukoli oznámení s libovolným textem
-- a odkazem. Odkaz musel začínat lomítkem - jenže "//nekde.jinde" lomítkem
-- začíná taky a prohlížeč ho otevře jako cizí web. Phishing pod značkou
-- Kine pro všechny uživatele najednou.
--
-- Oznámení posílá i prohlížeč (odběr, komentář, pozvánka ke spolupráci...),
-- takže zápis z appky zůstává - jen ho teď hlídá databáze:
--   - odkaz smí vést jen na stránku Kine (/neco), ne "//", "/\" ani mezery,
--   - odesílatel se zapíše (sender_id) a nejde zfalšovat,
--   - druhy, které posílá jen server (dar, živě, nové video, zhlédnutí,
--     obecné "od Kine"), z prohlížeče neprojdou - obecné jen sám sobě;
--     upozornění moderátora jen od moderátora,
--   - pozvánka ke spolupráci jen k vlastnímu videu se skutečnou pozvánkou,
--   - nejvýš 20 oznámení za minutu, 200 za hodinu a 15 za hodinu
--     jednomu člověku - co je navíc, se potichu zahodí (pozvánka ke
--     spolupráci místo toho vrátí chybu, ať o ní tvůrce ví),
--   - čas vytvoření určuje databáze (nejde si připnout oznámení nahoru),
--   - staré záznamy s odkazem ven se opraví (odkaz se smaže).

do $mig$
declare
  spatnych int := 0;
begin
  if to_regclass('public.notifications') is null then
    insert into _migrace_zprava (co, vysledek) values ('oznameni', 'tabulka notifications neexistuje, preskoceno');
    return;
  end if;

  execute 'alter table notifications add column if not exists type text not null default ''default''';
  execute 'alter table notifications add column if not exists sender_id uuid references profiles(id) on delete set null';
  execute 'create index if not exists idx_notifications_sender_created on notifications (sender_id, created_at desc) where sender_id is not null';

  -- Odkaz: "/" nebo "/" + písmeno/číslice/-/_ a dál bez mezer, řídicích
  -- znaků a zpětných lomítek. Staré záznamy se nekontrolují (not valid),
  -- nové a upravené ano.
  execute 'alter table notifications drop constraint if exists notifications_link_internal';
  execute $c$alter table notifications add constraint notifications_link_internal
             check (link is null or link ~ '^/([A-Za-z0-9_-][^[:space:][:cntrl:]\\]*)?$') not valid$c$;

  execute 'alter table notifications drop constraint if exists notifications_message_length';
  execute 'alter table notifications add constraint notifications_message_length
             check (char_length(message) <= 1000) not valid';

  -- Staré záznamy s odkazem ven přijdou o odkaz, příliš dlouhé texty se
  -- zkrátí. Jinak by kontrola nedovolila ani označit je jako přečtené
  -- (platí i pro úpravy). Pak se kontroly ověří na celé tabulce.
  execute $c$update notifications set link = null
             where link is not null and link !~ '^/([A-Za-z0-9_-][^[:space:][:cntrl:]\\]*)?$'$c$;
  get diagnostics spatnych = row_count;
  execute 'update notifications set message = left(message, 1000) where char_length(message) > 1000';
  execute 'alter table notifications validate constraint notifications_link_internal';
  execute 'alter table notifications validate constraint notifications_message_length';

  insert into _migrace_zprava (co, vysledek)
  values ('oznameni: stare zaznamy s odkazem ven (odkaz smazan)', spatnych::text);
end $mig$;

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
begin
  -- Server (service role) a správce v SQL editoru omezení nemají.
  if ja is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  new.sender_id := ja;
  new.created_at := now();
  new.read := false;
  new.type := coalesce(new.type, 'default');

  if new.type not in ('default', 'collab_invite', 'comment_reply', 'like_milestone', 'subscription', 'moderation_warning')
     or (new.type = 'default' and new.user_id is distinct from ja) then
    raise exception 'Tenhle druh oznámení posílá jen Kine.' using errcode = 'insufficient_privilege';
  end if;

  if new.type = 'moderation_warning' then
    begin
      select coalesce(p.role in ('moderator', 'admin'), false) or coalesce(p.is_admin, false)
        into je_moderator
        from profiles p where p.id = ja;
    exception when others then
      je_moderator := false;
    end;
    if not coalesce(je_moderator, false) then
      raise exception 'Upozornění od moderátora posílá jen moderátor.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.type = 'collab_invite' and not exists (
    select 1
    from video_collaborators vc
    join videos v on v.id = vc.video_id
    where vc.profile_id = new.user_id
      and v.owner_id = ja
      and new.link = '/watch/' || vc.video_id::text
  ) then
    raise exception 'Pozvánka ke spolupráci jde poslat jen k vlastnímu videu.' using errcode = 'insufficient_privilege';
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
      -- Pozvánka se nesmí ztratit potichu - video by zůstalo schované a nikdo by nevěděl proč.
      raise exception 'Moc rychle - zkus to prosím za chvíli.' using errcode = 'KN429';
    end if;
    return null; -- potichu zahodit: spam nedojde, appka u odesílatele nespadne
  end if;

  return new;
end;
$$;

do $mig$
declare
  pol record;
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  execute 'drop trigger if exists trg_notifications_client_guard on notifications';
  execute 'create trigger trg_notifications_client_guard before insert on notifications
           for each row execute function notifications_client_guard()';

  -- Všechny dosavadní politiky pro zápis pryč. Politiky se sčítají (stačí
  -- projít jednou), takže kdyby zůstala stará "with check (true)" - třeba
  -- pod jiným nebo zkráceným jménem - díra by zůstala otevřená.
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'notifications' and cmd = 'INSERT'
  loop
    execute format('drop policy %I on notifications', pol.policyname);
  end loop;
  execute 'create policy "Přihlášený posílá oznámení pod svým jménem" on notifications
             for insert to authenticated
             with check (auth.uid() is not null and sender_id = auth.uid())';

  -- Vlastní oznámení jde jen označit jako přečtené (text ani odkaz už ne).
  execute 'revoke update on notifications from anon, authenticated';
  execute 'grant update (read) on notifications to authenticated';

  insert into _migrace_zprava (co, vysledek)
  values ('oznameni: hlidani odesilatele, druhu, odkazu a tempa', 'zapnuto');
end $mig$;


-- =====================================================================
-- 2. Ankety v příspěvcích
-- =====================================================================
-- Kvůli hlasování platilo "for update to authenticated using (true)" -
-- kdokoli přihlášený mohl přepsat jakýkoli příspěvek (text, obrázek,
-- výsledky ankety). Teď se hlasuje funkcí: zapíše hlas (jeden na člověka)
-- a výsledky spočítá z odevzdaných hlasů, takže je nejde ani nafouknout.
-- Upravovat příspěvky z prohlížeče nejde vůbec - appka to nikde nedělá.

create or replace function vote_post_poll(p_post_id uuid, p_option int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  moznosti jsonb;
  pocet int;
  vysledek jsonb := '[]'::jsonb;
  hlasu int;
  zablokovany boolean := false;
begin
  if ja is null then
    raise exception 'Musíš být přihlášený.' using errcode = 'insufficient_privilege';
  end if;

  begin
    select coalesce(p.is_banned, false) into zablokovany from profiles p where p.id = ja;
  exception when others then
    zablokovany := false;
  end;
  if coalesce(zablokovany, false) then
    raise exception 'Účet je zablokovaný.' using errcode = 'insufficient_privilege';
  end if;

  -- "for update": souběžné hlasy se seřadí a počty sedí.
  select poll_options into moznosti
    from posts
   where id = p_post_id and type = 'poll'
   for update;

  if moznosti is null or jsonb_typeof(moznosti) <> 'array' then
    raise exception 'Anketa nenalezena.' using errcode = 'no_data_found';
  end if;

  pocet := jsonb_array_length(moznosti);
  if p_option is null or p_option < 0 or p_option >= pocet then
    raise exception 'Taková možnost v anketě není.' using errcode = 'invalid_parameter_value';
  end if;

  insert into post_votes (post_id, user_id, option_index)
  values (p_post_id, ja, p_option)
  on conflict (post_id, user_id) do nothing;
  if not found then
    return moznosti; -- už hlasoval - nic se nemění, řádek se zbytečně nepřepisuje
  end if;

  for i in 0 .. pocet - 1 loop
    select count(*) into hlasu from post_votes where post_id = p_post_id and option_index = i;
    vysledek := vysledek || jsonb_build_array(
      (case when jsonb_typeof(moznosti -> i) = 'object' then moznosti -> i else jsonb_build_object('text', moznosti -> i) end)
      || jsonb_build_object('votes', hlasu)
    );
  end loop;

  update posts set poll_options = vysledek where id = p_post_id;
  return vysledek;
end;
$$;

revoke execute on function vote_post_poll(uuid, int) from public, anon;
grant execute on function vote_post_poll(uuid, int) to authenticated, service_role;

do $mig$
declare
  pol record;
  smazano text[] := '{}';
begin
  if to_regclass('public.posts') is null then
    insert into _migrace_zprava (co, vysledek) values ('ankety', 'tabulka posts neexistuje, preskoceno');
    return;
  end if;
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'posts' and cmd = 'UPDATE'
  loop
    execute format('drop policy %I on posts', pol.policyname);
    smazano := smazano || pol.policyname::text;
  end loop;
  insert into _migrace_zprava (co, vysledek)
  values ('ankety: prepis prispevku z prohlizece zrusen (hlasuje se funkci vote_post_poll)',
          coalesce(nullif(array_to_string(smazano, ', '), ''), 'nebylo co rusit'));
end $mig$;


-- =====================================================================
-- 3. Tempo zápisů a délka komentáře
-- =====================================================================
-- Komentáře, hlášení a odběry se zapisují přímo z prohlížeče. Bez stropu
-- šlo jedním skriptem vložit tisíce komentářů po stovkách kB, zahltit
-- frontu hlášení nebo "odebírat" tisíce kanálů. Teď:
--   komentáře  10 za minutu, 150 za hodinu, nejvýš 2000 znaků
--   hlášení     5 za minutu,  30 za hodinu
--   odběry     30 za minutu, 200 za hodinu
-- Server (service role) omezení nemá. Chyba má kód KN429, appka podle něj
-- ukáže "Píšeš moc rychle".

create or replace function kine_limit_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  sloupec text := tg_argv[0];
  max_za_minutu int := tg_argv[1]::int;
  max_za_hodinu int := tg_argv[2]::int;
  za_minutu int := 0;
  za_hodinu int := 0;
begin
  if ja is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Čas zápisu určuje databáze - se starým datem by se zápis do limitu nepočítal.
  new.created_at := now();

  execute format(
    'select count(*) filter (where created_at > now() - interval ''1 minute''), count(*)
       from %I where %I = $1 and created_at > now() - interval ''1 hour''',
    tg_table_name, sloupec)
    into za_minutu, za_hodinu
    using ja;

  if za_minutu >= max_za_minutu or za_hodinu >= max_za_hodinu then
    raise exception 'Moc rychle - zkus to prosím za chvíli.' using errcode = 'KN429';
  end if;

  return new;
end;
$$;

do $mig$
declare
  hotovo text[] := '{}';
  t record;
begin
  for t in
    select * from (values
      ('comments', 'user_id', 10, 150),
      ('reports', 'reporter_id', 5, 30),
      ('subscriptions', 'subscriber_id', 30, 200)
    ) as x(tabulka, sloupec, za_minutu, za_hodinu)
  loop
    if to_regclass('public.' || t.tabulka) is null then
      continue;
    end if;
    execute format('create index if not exists %I on %I (%I, created_at desc)',
                   'idx_' || t.tabulka || '_tempo', t.tabulka, t.sloupec);
    execute format('drop trigger if exists %I on %I', 'trg_' || t.tabulka || '_tempo', t.tabulka);
    execute format('create trigger %I before insert on %I for each row execute function kine_limit_rate(%L, %L, %L)',
                   'trg_' || t.tabulka || '_tempo', t.tabulka, t.sloupec, t.za_minutu::text, t.za_hodinu::text);
    hotovo := hotovo || t.tabulka;
  end loop;

  if to_regclass('public.comments') is not null then
    execute 'alter table comments drop constraint if exists comments_content_length';
    execute 'alter table comments add constraint comments_content_length check (char_length(content) <= 2000) not valid';
    hotovo := hotovo || 'comments: delka 2000'::text;
  end if;

  if to_regclass('public.reports') is not null then
    execute 'alter table reports drop constraint if exists reports_text_length';
    execute 'alter table reports add constraint reports_text_length
               check (char_length(reason) <= 200 and char_length(coalesce(details, '''')) <= 5000) not valid';
    hotovo := hotovo || 'reports: delka'::text;
  end if;

  insert into _migrace_zprava (co, vysledek)
  values ('tempo zapisu a delka', array_to_string(hotovo, ', '));
end $mig$;

-- Úpravy jen ve sloupcích, které appka opravdu mění. Politika pro
-- připnutí komentáře dovolovala majiteli videa přepsat u cizího komentáře
-- cokoli - i text a autora (podvržený komentář za kohokoli). U odběru šlo
-- přepsat kanál nebo čas a obejít tak strop rychlosti.
do $mig$
declare
  sloupce text;
  hotovo text[] := '{}';
begin
  if to_regclass('public.comments') is not null then
    select string_agg(quote_ident(column_name), ', ') into sloupce
      from information_schema.columns
     where table_schema = 'public' and table_name = 'comments'
       and column_name in ('pinned', 'hearted_by_creator');
    execute 'revoke update on comments from anon, authenticated';
    if sloupce is not null then
      execute format('grant update (%s) on comments to authenticated', sloupce);
    end if;
    hotovo := hotovo || ('comments: ' || coalesce(sloupce, 'nic'));
  end if;

  if to_regclass('public.subscriptions') is not null then
    select string_agg(quote_ident(column_name), ', ') into sloupce
      from information_schema.columns
     where table_schema = 'public' and table_name = 'subscriptions'
       and column_name in ('notify_new_videos');
    execute 'revoke update on subscriptions from anon, authenticated';
    if sloupce is not null then
      execute format('grant update (%s) on subscriptions to authenticated', sloupce);
    end if;
    hotovo := hotovo || ('subscriptions: ' || coalesce(sloupce, 'nic'));
  end if;

  insert into _migrace_zprava (co, vysledek)
  values ('upravy z prohlizece jen v povolenych sloupcich', array_to_string(hotovo, '; '));
end $mig$;


-- =====================================================================
-- 4. Video: soubor a stav mění jen server
-- =====================================================================
-- Majitel smí u svého videa měnit název, popis, náhled, viditelnost...
-- ale ne to, na který soubor u Cloudflare řádek ukazuje (šlo by tak
-- "převzít" cizí video pod svůj kanál), ani stav zpracování (ready dává
-- jen server, když Cloudflare video opravdu zpracuje).

create or replace function protect_video_core_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role' then
    new.cloudflare_video_id := old.cloudflare_video_id;
    new.status := old.status;
  end if;
  return new;
end;
$$;

do $mig$
begin
  if to_regclass('public.videos') is null then
    insert into _migrace_zprava (co, vysledek) values ('ochrana videa', 'tabulka videos neexistuje, preskoceno');
    return;
  end if;
  execute 'drop trigger if exists trg_protect_video_core_fields on videos';
  execute 'create trigger trg_protect_video_core_fields before update on videos
           for each row execute function protect_video_core_fields()';
  insert into _migrace_zprava (co, vysledek) values ('ochrana videa (soubor a stav jen serverem)', 'zapnuto');
end $mig$;


-- =====================================================================
-- 5. Funkce s právy správce mají pevnou search_path
-- =====================================================================
-- "security definer" funkce (is_staff, my_account, ochrany sloupců
-- protect_*, prevent_*, reject_if_banned...) běží s právy správce. Bez
-- pevné search_path by šly teoreticky obejít objektem nastrčeným dřív
-- v cestě hledání. Přes API Supabase se to udělat nedá, ale je to
-- standardní pojistka (hlásí ji i Supabase Advisor). Funkce rozšíření
-- (unaccent, pg_trgm...) zůstanou dostupné - jsou ve schématu extensions.

do $mig$
declare
  f record;
  hotovo int := 0;
  chyby text[] := '{}';
begin
  for f in
    select p.oid::regprocedure::text as podpis
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    begin
      execute format('alter routine %s set search_path = public, extensions, pg_temp', f.podpis);
      hotovo := hotovo + 1;
    exception when others then
      chyby := chyby || (f.podpis || ': ' || sqlerrm);
    end;
  end loop;

  insert into _migrace_zprava (co, vysledek)
  values ('funkce s pevnou search_path', hotovo::text);
  if coalesce(array_length(chyby, 1), 0) > 0 then
    insert into _migrace_zprava (co, vysledek)
    values ('funkce, ktere se zmenit nepodarilo', array_to_string(chyby, '; '));
  end if;
end $mig$;


-- =====================================================================
-- 6. Vysílání z appky Kine
-- =====================================================================
-- app_ping_at: kdy appka naposledy ohlásila "vysílám" (stejný sloupec
-- zakládá supabase-migration-live-app.sql). cf_confirmed_at: kdy přenos
-- naposledy viděl Cloudflare - podle toho Kine pozná, jestli hlášení
-- z appky věřit, nebo jestli někdo jen předstírá, že vysílá.
do $mig$
begin
  if to_regclass('public.live_streams') is null then
    insert into _migrace_zprava (co, vysledek) values ('vysilani z appky', 'tabulka live_streams neexistuje, preskoceno');
    return;
  end if;
  execute 'alter table live_streams add column if not exists app_ping_at timestamptz';
  execute 'alter table live_streams add column if not exists cf_confirmed_at timestamptz';
  insert into _migrace_zprava (co, vysledek) values ('vysilani z appky (app_ping_at, cf_confirmed_at)', 'hotovo');
end $mig$;


-- Ať Supabase nové funkce hned uvidí.
notify pgrst, 'reload schema';


-- =====================================================================
-- Souhrn
-- =====================================================================
select co as "co se delo", vysledek as "vysledek"
from _migrace_zprava order by poradi;

-- Kontrola v appce po spuštění:
-- - Odběr kanálu, komentář a pozvánka ke spolupráci pořád pošlou oznámení.
-- - Hlasování v anketě funguje a výsledky sedí.
-- - Rychle za sebou odeslaných 11 komentářů: jedenáctý appka odmítne
--   s hláškou "Píšeš moc rychle".
