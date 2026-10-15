-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- ZABEZPEČENÍ A LIMITY (před spuštěním Kine pro veřejnost, říjen 2026)
--
-- Skript se dá pustit opakovaně a nespadne ani na databázi, kde některá
-- starší migrace chybí (takovou část jen přeskočí). Na konci vypíše
-- tabulku s tím, co udělal. Patří k němu kód ze stejné dodávky - pořadí
-- nasazení je jedno, web funguje před spuštěním i po něm.
--
--   1. Profil: nikdo si při registraci nezaloží účet správce, moderátora
--      ani předplatné (dřív šlo z konzole prohlížeče poslat při založení
--      profilu role = 'admin' nebo plan = 'all' - hlídaly se jen úpravy).
--      Sloupce, které mění jen server (Stripe, odznaky, výdělky...),
--      z prohlížeče nezmění nikdo; moderátor u cizího profilu jen blokuje.
--   2. Videa: z prohlížeče jde jen upravit vlastní video (název, popis,
--      náhled, viditelnost, kapitoly, titulky, komentáře) - ne založit,
--      smazat, přepsat vlastníka, délku nebo soubor u Cloudflare. Mazání
--      jde jen přes server (ten smaže i soubor u Cloudflare).
--   3. Spolupráce na videu: pozvánku nejde rovnou "přijmout" za druhého
--      a přijatou spolupráci nejde přesunout na cizí (soukromé) video.
--   4. Záznam zhlédnutí zapisuje jen server (dřív mohl kdokoli).
--   5. Soukromé playlisty vidí jen jejich majitel (dřív si šly vypsat
--      všechny, i "Sledovat později").
--   6. Úložiště obrázků: jen obrázky, jen do vlastní složky, omezená
--      velikost a počet za den, náhled jen k vlastnímu videu. Dřív si šlo
--      z úložiště Kine udělat bezplatný hosting libovolných souborů.
--   7. Nahrávání videí: lístky na nahrání (upload_tickets), fronta mazání
--      u Cloudflare (cloudflare_cleanup) a záznam mazání (deleted_videos_log).
--   8. Vysílání: sloupce pro vypnutí vstupu (zablokovaný účet, přenos
--      delší než 12 hodin).


drop table if exists _migrace_zprava;
create temp table _migrace_zprava (poradi serial, co text, vysledek text);


-- =====================================================================
-- 0. Kdo volá: server (service role) / SQL editor, nebo člověk z prohlížeče?
-- =====================================================================
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

-- Generované sloupce tabulky (videos.search_tsv...) - ochranné spouštěče je
-- nesmí přepisovat, počítá je databáze sama.
create or replace function kine_generated_columns(rel regclass)
returns text[]
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(attname::text), '{}'::text[])
    from pg_attribute
   where attrelid = rel and attnum > 0 and not attisdropped and attgenerated <> '';
$$;

grant execute on function kine_generated_columns(regclass) to anon, authenticated, service_role;


-- =====================================================================
-- 1. Profily
-- =====================================================================
create or replace function kine_guard_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  muj_role text := 'user';
  stare jsonb;
  nove jsonb;
  zpet jsonb;
  -- Mění jen server (Stripe, odznaky, chat, výdělky, správa) - z prohlížeče se vrátí.
  chranene constant text[] := array[
    'is_admin', 'verification_tier', 'username_exempt', 'is_supporter',
    'revenue_share_percent', 'revenue_share_manual', 'partner_status', 'revenue_share_note',
    'plan', 'plan_until', 'plan_stripe_subscription_id', 'plan_stripe_customer_id', 'plan_note',
    'stripe_account_id', 'stripe_onboarding_complete', 'subscription_price_eur', 'subscription_stripe_price_id',
    'live_seconds', 'badge_showcase', 'badges_seen', 'chat_color', 'live_tips_enabled', 'created_at'
  ];
  -- Blokace: moderátor a správce (i u cizího profilu).
  moderatorske constant text[] := array['is_banned', 'is_shadow_banned', 'payouts_suspended'];
begin
  if kine_is_server() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if ja is null or new.id is distinct from ja then
      raise exception 'Profil jde založit jen sám sobě.' using errcode = 'insufficient_privilege';
    end if;
    -- Nový profil z prohlížeče: jen jméno a zobrazované jméno, všechno ostatní výchozí.
    new := jsonb_populate_record(new, jsonb_build_object(
      'role', 'user', 'is_admin', false, 'is_banned', false, 'is_shadow_banned', false,
      'payouts_suspended', false, 'is_supporter', false, 'verification_tier', 'none',
      'username_exempt', false, 'revenue_share_percent', 25, 'revenue_share_manual', false,
      'partner_status', 'standard', 'revenue_share_note', null,
      'plan', 'free', 'plan_until', null, 'plan_stripe_subscription_id', null,
      'plan_stripe_customer_id', null, 'plan_note', null,
      'stripe_account_id', null, 'stripe_onboarding_complete', false,
      'subscription_price_eur', null, 'subscription_stripe_price_id', null,
      'live_seconds', 0, 'badge_showcase', null, 'badges_seen', null,
      'chat_color', null, 'trailer_video_id', null, 'live_tips_enabled', true,
      'created_at', now()
    ));
  else
    stare := to_jsonb(old) - kine_generated_columns(tg_relid);
    nove := to_jsonb(new) - kine_generated_columns(tg_relid);
    if ja is not null then
      begin
        select coalesce(p.role, 'user') into muj_role from profiles p where p.id = ja;
      exception when others then
        muj_role := 'user';
      end;
    end if;
    muj_role := coalesce(muj_role, 'user');

    if ja is null or ja <> old.id then
      -- Cizí profil: moderátor jen blokuje / odblokuje, správce navíc mění roli. Nic jiného.
      zpet := stare;
      if muj_role in ('moderator', 'admin') then
        zpet := zpet || (select coalesce(jsonb_object_agg(k, nove -> k), '{}'::jsonb) from unnest(moderatorske) as k where nove ? k);
      end if;
      if muj_role = 'admin' and nove ? 'role' then
        zpet := zpet || jsonb_build_object('role', nove -> 'role');
      end if;
      new := jsonb_populate_record(new, zpet);
      return new;
    end if;

    -- Vlastní profil: serverové sloupce zpátky.
    zpet := (select coalesce(jsonb_object_agg(k, stare -> k), '{}'::jsonb) from unnest(chranene) as k where stare ? k);
    if muj_role <> 'admin' and stare ? 'role' then
      zpet := zpet || jsonb_build_object('role', stare -> 'role');
    end if;
    if muj_role not in ('moderator', 'admin') then
      zpet := zpet || (select coalesce(jsonb_object_agg(k, stare -> k), '{}'::jsonb) from unnest(moderatorske) as k where stare ? k);
    end if;
    zpet := zpet || jsonb_build_object('id', stare -> 'id');
    new := jsonb_populate_record(new, zpet);
    nove := to_jsonb(new);

    -- Upoutávka kanálu jen z vlastních videí.
    if (nove ->> 'trailer_video_id') is not null
       and (nove ->> 'trailer_video_id') is distinct from (stare ->> 'trailer_video_id')
       and not exists (select 1 from videos v where v.id = (nove ->> 'trailer_video_id')::uuid and v.owner_id = old.id) then
      new := jsonb_populate_record(new, jsonb_build_object('trailer_video_id', stare -> 'trailer_video_id'));
      nove := to_jsonb(new);
    end if;

    -- Rozumné délky a tvary (kontroluje se jen to, co se mění).
    if (nove ->> 'display_name') is distinct from (stare ->> 'display_name') and char_length(coalesce(nove ->> 'display_name', '')) > 60 then
      raise exception 'Zobrazované jméno je moc dlouhé (nejvýš 60 znaků).' using errcode = 'check_violation';
    end if;
    if (nove ->> 'bio') is distinct from (stare ->> 'bio') and char_length(coalesce(nove ->> 'bio', '')) > 2000 then
      raise exception 'Popis kanálu je moc dlouhý (nejvýš 2000 znaků).' using errcode = 'check_violation';
    end if;
    if (nove -> 'social_links') is distinct from (stare -> 'social_links') and (nove -> 'social_links') is not null
       and jsonb_typeof(nove -> 'social_links') <> 'null'
       and (jsonb_typeof(nove -> 'social_links') <> 'array'
            or jsonb_array_length(nove -> 'social_links') > 10
            or char_length((nove -> 'social_links')::text) > 4000) then
      raise exception 'Odkazů je moc (nejvýš 10).' using errcode = 'check_violation';
    end if;
    if (nove ->> 'avatar_url') is distinct from (stare ->> 'avatar_url') and (nove ->> 'avatar_url') is not null
       and ((nove ->> 'avatar_url') !~ '^https://' or char_length(nove ->> 'avatar_url') > 600) then
      raise exception 'Neplatná adresa profilovky.' using errcode = 'check_violation';
    end if;
    if (nove ->> 'banner_url') is distinct from (stare ->> 'banner_url') and (nove ->> 'banner_url') is not null
       and ((nove ->> 'banner_url') !~ '^https://' or char_length(nove ->> 'banner_url') > 600) then
      raise exception 'Neplatná adresa banneru.' using errcode = 'check_violation';
    end if;
    if (nove ->> 'brand_color') is distinct from (stare ->> 'brand_color') and (nove ->> 'brand_color') is not null
       and (nove ->> 'brand_color') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'Neplatná barva.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

do $mig$
begin
  if to_regclass('public.profiles') is null then
    insert into _migrace_zprava (co, vysledek) values ('profily', 'tabulka profiles neexistuje, preskoceno');
    return;
  end if;
  execute 'drop trigger if exists trg_kine_guard_profile on profiles';
  execute 'create trigger trg_kine_guard_profile before insert or update on profiles
           for each row execute function kine_guard_profile()';
  insert into _migrace_zprava (co, vysledek) values ('profily: ochrana pri zalozeni i uprave', 'zapnuto');
end $mig$;


-- =====================================================================
-- 2. Videa
-- =====================================================================
-- Z prohlížeče jen úprava vlastního videa ve sloupcích, které appka mění.
-- Zakládá a maže jen server (/api/videos/confirm, /api/videos/delete).
create or replace function kine_guard_video()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  stare jsonb;
  nove jsonb;
begin
  if kine_is_server() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Video ukládá jen server.' using errcode = 'insufficient_privilege';
  end if;

  stare := to_jsonb(old) - kine_generated_columns(tg_relid);
  nove := to_jsonb(new) - kine_generated_columns(tg_relid);

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
  -- Vlastní náhled jen z vlastní složky v úložišti Kine.
  if (nove ->> 'thumbnail_url') is distinct from (stare ->> 'thumbnail_url') and (nove ->> 'thumbnail_url') is not null
     and ((nove ->> 'thumbnail_url') !~ '^https://'
          or char_length(nove ->> 'thumbnail_url') > 600
          or position(('/storage/v1/object/public/thumbnails/' || old.owner_id::text || '/') in (nove ->> 'thumbnail_url')) = 0) then
    raise exception 'Náhled musí být obrázek nahraný na Kine.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

do $mig$
declare
  sloupce text;
  pol record;
  smazano text[] := '{}';
begin
  if to_regclass('public.videos') is null then
    insert into _migrace_zprava (co, vysledek) values ('videa', 'tabulka videos neexistuje, preskoceno');
    return;
  end if;

  execute 'drop trigger if exists trg_kine_guard_video on videos';
  execute 'create trigger trg_kine_guard_video before insert or update on videos
           for each row execute function kine_guard_video()';

  -- Zakládat a mazat z prohlížeče nejde vůbec (appka to dělá přes server).
  execute 'revoke insert, delete on videos from anon, authenticated';
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'videos' and cmd in ('INSERT', 'DELETE')
  loop
    execute format('drop policy %I on videos', pol.policyname);
    smazano := smazano || pol.policyname::text;
  end loop;

  -- Upravovat jen sloupce, které appka opravdu mění.
  select string_agg(quote_ident(column_name), ', ') into sloupce
    from information_schema.columns
   where table_schema = 'public' and table_name = 'videos'
     and column_name in ('title', 'description', 'thumbnail_url', 'custom_thumbnail', 'visibility',
                         'chapters', 'captions', 'pending_collab_visibility', 'comments_disabled');
  execute 'revoke update on videos from anon, authenticated';
  if sloupce is not null then
    execute format('grant update (%s) on videos to authenticated', sloupce);
  end if;

  insert into _migrace_zprava (co, vysledek) values ('videa: upravy z prohlizece jen ve sloupcich', coalesce(sloupce, 'zadne'));
  insert into _migrace_zprava (co, vysledek)
  values ('videa: zakladani a mazani z prohlizece zruseno (politiky)', coalesce(nullif(array_to_string(smazano, ', '), ''), 'nebylo co rusit'));
end $mig$;


-- =====================================================================
-- 3. Spolupráce na videu
-- =====================================================================
-- Přijímá / odmítá se přes server (/api/videos/respond-collab). Přímý zápis
-- z prohlížeče šel zneužít: pozvaný si změnil video_id na cizí soukromé
-- video a jako "spolutvůrce" ho pak viděl.
create or replace function kine_guard_collaborator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if kine_is_server() then
    return new;
  end if;
  -- Pozvánku musí druhá strana potvrdit sama.
  new := jsonb_populate_record(new, jsonb_build_object('status', 'pending'));
  return new;
end;
$$;

do $mig$
begin
  if to_regclass('public.video_collaborators') is null then
    insert into _migrace_zprava (co, vysledek) values ('spoluprace', 'tabulka video_collaborators neexistuje, preskoceno');
    return;
  end if;
  execute 'revoke update on video_collaborators from anon, authenticated';
  execute 'drop trigger if exists trg_kine_guard_collaborator on video_collaborators';
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'video_collaborators' and column_name = 'status') then
    execute 'create trigger trg_kine_guard_collaborator before insert on video_collaborators
             for each row execute function kine_guard_collaborator()';
  end if;
  insert into _migrace_zprava (co, vysledek) values ('spoluprace: prijeti jen pres server, pozvanka vzdy ceka', 'zapnuto');
end $mig$;


-- =====================================================================
-- 4. Záznam zhlédnutí jen ze serveru
-- =====================================================================
do $mig$
declare
  pol record;
begin
  if to_regclass('public.views_log') is null then
    insert into _migrace_zprava (co, vysledek) values ('views_log', 'tabulka neexistuje, preskoceno');
    return;
  end if;
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'views_log' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on views_log', pol.policyname);
  end loop;
  execute 'revoke insert, update, delete on views_log from anon, authenticated';
  insert into _migrace_zprava (co, vysledek) values ('views_log: zapis jen serverem', 'zapnuto');
end $mig$;


-- =====================================================================
-- 5. Soukromé playlisty
-- =====================================================================
do $mig$
declare
  pol record;
  ma_viditelnost boolean;
begin
  if to_regclass('public.playlists') is null then
    insert into _migrace_zprava (co, vysledek) values ('playlisty', 'tabulka playlists neexistuje, preskoceno');
    return;
  end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'playlists' and column_name = 'visibility')
    into ma_viditelnost;
  if not ma_viditelnost then
    insert into _migrace_zprava (co, vysledek) values ('playlisty', 'sloupec visibility chybi, preskoceno');
    return;
  end if;

  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'playlists' and cmd in ('SELECT', 'ALL') and coalesce(qual, '') = 'true'
  loop
    execute format('drop policy %I on playlists', pol.policyname);
  end loop;
  execute 'drop policy if exists "Playlist vidí majitel, veřejný každý" on playlists';
  execute $p$create policy "Playlist vidí majitel, veřejný každý" on playlists for select
             using (visibility = 'public' or owner_id = auth.uid())$p$;

  if to_regclass('public.playlist_videos') is not null then
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = 'playlist_videos' and cmd in ('SELECT', 'ALL') and coalesce(qual, '') = 'true'
    loop
      execute format('drop policy %I on playlist_videos', pol.policyname);
    end loop;
    execute 'drop policy if exists "Obsah playlistu vidí, kdo vidí playlist" on playlist_videos';
    execute $p$create policy "Obsah playlistu vidí, kdo vidí playlist" on playlist_videos for select
               using (exists (select 1 from playlists p
                              where p.id = playlist_videos.playlist_id
                                and (p.visibility = 'public' or p.owner_id = auth.uid())))$p$;
  end if;
  insert into _migrace_zprava (co, vysledek) values ('playlisty: soukrome vidi jen majitel', 'zapnuto');
end $mig$;


-- =====================================================================
-- 6. Úložiště obrázků
-- =====================================================================
-- Kolik souborů nahrál přihlášený do bucketu za posledních 24 hodin.
create or replace function kine_storage_recent_uploads(p_bucket text)
returns integer
language sql
stable
security definer
set search_path = storage, public, pg_temp
as $$
  select count(*)::int
    from storage.objects o
   where o.bucket_id = p_bucket
     and o.name like (auth.uid()::text || '/%')
     and o.created_at > now() - interval '24 hours';
$$;

revoke execute on function kine_storage_recent_uploads(text) from public, anon;
grant execute on function kine_storage_recent_uploads(text) to authenticated, service_role;

do $mig$
declare
  pol record;
  smazano text[] := '{}';
  nase constant text[] := array['avatars', 'banners', 'thumbnails', 'post-images', 'comment-images', 'playlist-covers', 'playlist-thumbnails'];
  b text;
  obrazky constant text[] := array['image/jpeg', 'image/png', 'image/apng', 'image/webp', 'image/gif', 'image/avif'];
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    insert into _migrace_zprava (co, vysledek) values ('uloziste', 'schema storage neni, preskoceno');
    return;
  end if;

  -- Velikost a typ souboru u každého bucketu.
  begin
    update storage.buckets set file_size_limit = 5 * 1024 * 1024, allowed_mime_types = obrazky where id = 'avatars';
    update storage.buckets set file_size_limit = 10 * 1024 * 1024, allowed_mime_types = obrazky where id = 'banners';
    update storage.buckets set file_size_limit = 10 * 1024 * 1024, allowed_mime_types = obrazky where id = 'thumbnails';
    update storage.buckets set file_size_limit = 10 * 1024 * 1024, allowed_mime_types = obrazky where id = 'post-images';
    update storage.buckets set file_size_limit = 10 * 1024 * 1024, allowed_mime_types = obrazky where id = 'comment-images';
    update storage.buckets set file_size_limit = 5 * 1024 * 1024, allowed_mime_types = obrazky where id = 'playlist-covers';
    update storage.buckets set file_size_limit = 5 * 1024 * 1024, allowed_mime_types = obrazky where id = 'playlist-thumbnails';
    insert into _migrace_zprava (co, vysledek) values ('uloziste: velikost a typ souboru', 'nastaveno');
  exception when others then
    insert into _migrace_zprava (co, vysledek) values ('uloziste: velikost a typ souboru NEVYSLO', sqlerrm);
  end;

  -- Všechna dosavadní pravidla pro zápis do našich bucketů pryč (a úplně
  -- otevřená pravidla "with check (true)" pro jakýkoli bucket) - nová níž.
  for pol in
    select policyname, cmd, coalesce(qual, '') as q, coalesce(with_check, '') as w
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    if pol.q = 'true' or pol.w = 'true'
       or exists (select 1 from unnest(nase) as x where position(('''' || x || '''') in (pol.q || ' ' || pol.w)) > 0) then
      execute format('drop policy %I on storage.objects', pol.policyname);
      smazano := smazano || (pol.policyname || ' (' || pol.cmd || ')');
    end if;
  end loop;

  -- Čtení: obrázky jsou veřejné (bucket public) - kdyby čtecí pravidlo spadlo s "for all", vrátí se.
  foreach b in array nase loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
         and position(('''' || b || '''') in coalesce(qual, '')) > 0
    ) then
      execute format('create policy %I on storage.objects for select using (bucket_id = %L)', 'kine_' || b || '_read', b);
    end if;
  end loop;

  insert into _migrace_zprava (co, vysledek)
  values ('uloziste: stara pravidla pro zapis smazana', coalesce(nullif(array_to_string(smazano, ', '), ''), 'zadna'));
end $mig$;

-- Profilovky a bannery: pevná jména (avatar.png, avatar-anim.gif, avatar-still.webp...), přepsat jde.
drop policy if exists "kine_avatars_insert" on storage.objects;
create policy "kine_avatars_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name ~* ('^' || auth.uid()::text || '/avatar(-anim|-still)?\.(jpg|jpeg|png|webp|gif|avif)$'));
drop policy if exists "kine_avatars_update" on storage.objects;
create policy "kine_avatars_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and name ~* ('^' || auth.uid()::text || '/avatar(-anim|-still)?\.(jpg|jpeg|png|webp|gif|avif)$'));
drop policy if exists "kine_avatars_delete" on storage.objects;
create policy "kine_avatars_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "kine_banners_insert" on storage.objects;
create policy "kine_banners_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'banners' and name ~* ('^' || auth.uid()::text || '/banner(-anim|-still)?\.(jpg|jpeg|png|webp|gif|avif)$'));
drop policy if exists "kine_banners_update" on storage.objects;
create policy "kine_banners_update" on storage.objects for update to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'banners' and name ~* ('^' || auth.uid()::text || '/banner(-anim|-still)?\.(jpg|jpeg|png|webp|gif|avif)$'));
drop policy if exists "kine_banners_delete" on storage.objects;
create policy "kine_banners_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);

-- Náhledy videí: <uživatel>/<id vlastního videa>[-<čas>].<obrázek>, nejvýš 50 za den,
-- přepsat nejde (nový náhled = nový soubor - kontrola obsahu se nedá obejít).
drop policy if exists "kine_thumbnails_insert" on storage.objects;
create policy "kine_thumbnails_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'thumbnails'
    and name ~* ('^' || auth.uid()::text || '/[0-9a-f-]{36}(-[a-z0-9]{1,16})?\.(jpg|jpeg|png|webp|gif|avif)$')
    and exists (select 1 from public.videos v where v.id::text = lower(substr(storage.filename(name), 1, 36)) and v.owner_id = auth.uid())
    and public.kine_storage_recent_uploads('thumbnails') < 50
  );
drop policy if exists "kine_thumbnails_delete" on storage.objects;
create policy "kine_thumbnails_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

-- Fotky v příspěvcích: <uživatel>/<čas>-<pořadí>.<obrázek>, nejvýš 60 za den.
drop policy if exists "kine_post_images_insert" on storage.objects;
create policy "kine_post_images_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and name ~* ('^' || auth.uid()::text || '/[0-9]{10,16}(-[0-9]{1,3})?\.(jpg|jpeg|png|webp|gif|avif)$')
    and public.kine_storage_recent_uploads('post-images') < 60
  );
drop policy if exists "kine_post_images_delete" on storage.objects;
create policy "kine_post_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Obrázky v komentářích: <uživatel>/<čas>.<obrázek>, nejvýš 100 za den.
drop policy if exists "kine_comment_images_insert" on storage.objects;
create policy "kine_comment_images_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comment-images'
    and name ~* ('^' || auth.uid()::text || '/[0-9]{10,16}(-[a-z0-9]{1,16})?\.(jpg|jpeg|png|webp|gif|avif)$')
    and public.kine_storage_recent_uploads('comment-images') < 100
  );
drop policy if exists "kine_comment_images_delete" on storage.objects;
create policy "kine_comment_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'comment-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Obálky playlistů: <uživatel>/<id vlastního playlistu>.<obrázek>, přepsat jde.
drop policy if exists "kine_playlist_covers_insert" on storage.objects;
create policy "kine_playlist_covers_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'playlist-covers'
    and name ~* ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|avif)$')
    and exists (select 1 from public.playlists p where p.id::text = lower(substr(storage.filename(name), 1, 36)) and p.owner_id = auth.uid())
  );
drop policy if exists "kine_playlist_covers_update" on storage.objects;
create policy "kine_playlist_covers_update" on storage.objects for update to authenticated
  using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'playlist-covers'
    and name ~* ('^' || auth.uid()::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|avif)$')
  );
drop policy if exists "kine_playlist_covers_delete" on storage.objects;
create policy "kine_playlist_covers_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'playlist-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- Starý bucket playlist-thumbnails: appka ho už nepoužívá - zápis z prohlížeče žádný,
-- vlastní soubory jde jen smazat.
drop policy if exists "kine_playlist_thumbnails_delete" on storage.objects;
create policy "kine_playlist_thumbnails_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

insert into _migrace_zprava (co, vysledek) values ('uloziste: nova pravidla (jen obrazky, vlastni slozka, limity za den)', 'zapnuto');


-- =====================================================================
-- 7. Nahrávání videí: lístky, fronta mazání u Cloudflare, záznam mazání
-- =====================================================================
create table if not exists upload_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  cf_uid text not null,
  reserved_seconds integer not null check (reserved_seconds > 0),
  declared_seconds integer,
  file_bytes bigint,
  source text,
  status text not null default 'pending' check (status in ('pending', 'used', 'expired', 'failed')),
  video_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create unique index if not exists upload_tickets_cf_uid_key on upload_tickets (cf_uid);
create index if not exists upload_tickets_user_created_idx on upload_tickets (user_id, created_at desc);
create index if not exists upload_tickets_pending_idx on upload_tickets (expires_at) where status = 'pending';
alter table upload_tickets enable row level security;
revoke all on upload_tickets from anon, authenticated;
grant all on upload_tickets to service_role;

create table if not exists cloudflare_cleanup (
  uid text primary key,
  reason text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  next_try_at timestamptz not null default now()
);
create index if not exists cloudflare_cleanup_next_idx on cloudflare_cleanup (next_try_at);
alter table cloudflare_cleanup enable row level security;
revoke all on cloudflare_cleanup from anon, authenticated;
grant all on cloudflare_cleanup to service_role;

create table if not exists deleted_videos_log (
  id bigint generated always as identity primary key,
  video_id uuid,
  cf_uid text,
  owner_id uuid,
  deleted_by uuid,
  by_staff boolean not null default false,
  title text,
  created_at timestamptz not null default now()
);
create index if not exists deleted_videos_log_by_idx on deleted_videos_log (deleted_by, created_at desc);
alter table deleted_videos_log enable row level security;
revoke all on deleted_videos_log from anon, authenticated;
grant all on deleted_videos_log to service_role;

-- Kolik toho člověk nahrál (lib/uploadTickets.ts - uploadUsage): za 24 hodin,
-- rozpracované a celé úložiště. Klipy od diváků se do úložiště tvůrce nepočítají.
do $mig$
declare
  bez_klipu text := '';
begin
  if to_regclass('public.videos') is null then
    insert into _migrace_zprava (co, vysledek) values ('limity nahravani', 'tabulka videos neexistuje, preskoceno');
    return;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'videos' and column_name = 'clipped_from_video_id') then
    bez_klipu := ' and v.clipped_from_video_id is null';
  end if;
  execute format($f$
    create or replace function kine_upload_usage(p_user uuid)
    returns jsonb
    language sql
    stable
    security definer
    set search_path = public, pg_temp
    as $body$
      with t as (
        select t.status, t.reserved_seconds, t.created_at, t.expires_at, v.duration_seconds as actual
          from upload_tickets t
          left join videos v on v.id = t.video_id
         where t.user_id = p_user
           and (t.created_at > now() - interval '24 hours' or (t.status = 'pending' and t.expires_at > now()))
      )
      select jsonb_build_object(
        'uploadsToday', (select count(*) from t where created_at > now() - interval '24 hours'),
        'secondsToday', (select coalesce(sum(case when status = 'used' then coalesce(nullif(actual, 0), reserved_seconds) else reserved_seconds end), 0)
                           from t where created_at > now() - interval '24 hours' and status in ('pending', 'used')),
        'pending', (select count(*) from t where status = 'pending' and expires_at > now()),
        'pendingSeconds', (select coalesce(sum(reserved_seconds), 0) from t where status = 'pending' and expires_at > now()),
        'storedSeconds', (select coalesce(sum(v.duration_seconds), 0) from videos v
                           where v.owner_id = p_user and coalesce(v.status, '') <> 'failed'%s)
      );
    $body$
  $f$, bez_klipu);
  execute 'revoke execute on function kine_upload_usage(uuid) from public, anon, authenticated';
  execute 'grant execute on function kine_upload_usage(uuid) to service_role';
  insert into _migrace_zprava (co, vysledek) values ('limity nahravani (upload_tickets, kine_upload_usage)', 'hotovo');
end $mig$;


-- =====================================================================
-- 8. Vysílání: vypnutí vstupu (zablokovaný účet, přenos delší než 12 h)
-- =====================================================================
do $mig$
begin
  if to_regclass('public.live_inputs') is null then
    insert into _migrace_zprava (co, vysledek) values ('vysilani: vypnuti vstupu', 'tabulka live_inputs neexistuje, preskoceno');
    return;
  end if;
  execute 'alter table live_inputs add column if not exists disabled_at timestamptz';
  execute 'alter table live_inputs add column if not exists disabled_reason text';
  execute 'alter table live_inputs add column if not exists disabled_until timestamptz';
  insert into _migrace_zprava (co, vysledek) values ('vysilani: vypnuti vstupu (disabled_*)', 'hotovo');
end $mig$;


-- Ať Supabase nové tabulky a funkce hned uvidí.
notify pgrst, 'reload schema';


-- =====================================================================
-- Souhrn
-- =====================================================================
select co as "co se delo", vysledek as "vysledek"
from _migrace_zprava order by poradi;

-- Kontrola v appce po spuštění:
-- - Registrace nového účtu, úprava profilu, profilovka a banner fungují.
-- - Nahrání videa s vlastním náhledem, úprava videa (název, náhled), smazání.
-- - Fotka v příspěvku a obrázek v komentáři se nahraje.
-- - Obálka playlistu se nahraje; cizí soukromý playlist se neotevře.
