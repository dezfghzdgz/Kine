-- =====================================================================
-- Dodávka 0133 - jeden soubor, tři části (každá se sama přeskočí, když
-- chybí, na čem stojí). Spustit v Supabase -> SQL Editor. Jde pustit víckrát.
--
--  A) Zámky: dvě nahrávání naráz od jednoho uživatele se seřadí za sebe
--     (dřív šlo stovkou souběžných požadavků obejít denní limit nahrávání).
--  B) Statistiky živého vysílání: každé vysílání = jeden řádek (diváci,
--     délka); zprávy v chatu a podpory se dopočítají z jejich tabulek.
--  C) Příspěvky: až 10 fotek, brzda proti zahlcení, velikost ankety
--     a příspěvky jen pro členy kanálu (když existují členství).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) Zámky (jen server - service role)
-- ---------------------------------------------------------------------
create table if not exists kine_user_locks (
  key text primary key check (char_length(key) <= 120),
  locked_at timestamptz not null default now()
);
alter table kine_user_locks enable row level security;
-- Žádná politika: z appky se k zámkům nedostane nikdo, jen server.

-- ---------------------------------------------------------------------
-- B) Statistiky živého vysílání
-- ---------------------------------------------------------------------
do $mig$
begin
  if to_regclass('public.live_streams') is null then
    raise notice 'B) přeskočeno: chybí live_streams (živé vysílání ještě není v databázi).';
    return;
  end if;

  execute $sql$
    create table if not exists live_sessions (
      id uuid default gen_random_uuid() primary key,
      owner_id uuid not null references profiles(id) on delete cascade,
      started_at timestamptz not null,
      last_seen_at timestamptz not null default now(),
      title text not null default '',
      category text,
      peak_viewers int not null default 0 check (peak_viewers >= 0),
      viewer_sum bigint not null default 0 check (viewer_sum >= 0),
      viewer_samples int not null default 0 check (viewer_samples >= 0),
      unique (owner_id, started_at)
    )
  $sql$;
  execute 'create index if not exists live_sessions_owner_idx on live_sessions (owner_id, started_at desc)';
  execute 'alter table live_sessions enable row level security';
  execute 'drop policy if exists "Tvůrce vidí statistiky svých vysílání" on live_sessions';
  execute 'create policy "Tvůrce vidí statistiky svých vysílání" on live_sessions for select using (auth.uid() = owner_id)';

  -- Jeden vzorek (nejvýš jednou za 45 s - víc instancí serveru počty nezdvojí).
  execute $sql$
    create or replace function live_session_sample(p_owner uuid, p_started timestamptz, p_title text, p_category text, p_viewers int)
    returns void
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $f$
    declare
      divaku int := greatest(coalesce(p_viewers, 0), 0);
      vzorek int := case when p_viewers is null then 0 else 1 end;
    begin
      if p_owner is null or p_started is null then
        return;
      end if;
      insert into live_sessions (owner_id, started_at, title, category, peak_viewers, viewer_sum, viewer_samples, last_seen_at)
      values (p_owner, p_started, left(coalesce(p_title, ''), 200), p_category, divaku, divaku * vzorek, vzorek, now())
      on conflict (owner_id, started_at) do update set
        title = excluded.title,
        category = excluded.category,
        last_seen_at = now(),
        peak_viewers = greatest(live_sessions.peak_viewers, excluded.peak_viewers),
        viewer_sum = live_sessions.viewer_sum + excluded.viewer_sum,
        viewer_samples = live_sessions.viewer_samples + excluded.viewer_samples
      where live_sessions.last_seen_at < now() - interval '45 seconds';
    end;
    $f$
  $sql$;
  execute 'revoke execute on function live_session_sample(uuid, timestamptz, text, text, int) from public, anon, authenticated';
  execute 'grant execute on function live_session_sample(uuid, timestamptz, text, text, int) to service_role';
end $mig$;

-- ---------------------------------------------------------------------
-- C) Příspěvky
-- ---------------------------------------------------------------------
do $mig$
declare
  tym text;
  pol record;
begin
  if to_regclass('public.posts') is null then
    raise notice 'C) přeskočeno: chybí tabulka posts.';
    return;
  end if;

  -- Až 10 fotek v jednom příspěvku (dřív 4).
  execute 'alter table posts add column if not exists image_urls text[]';
  execute 'alter table posts drop constraint if exists posts_image_urls_max';
  execute 'alter table posts add constraint posts_image_urls_max check (image_urls is null or array_length(image_urls, 1) <= 10)';

  -- Anketa nesmí být obří (dřív šlo uložit libovolně velké JSON).
  execute 'alter table posts drop constraint if exists posts_poll_options_size';
  execute 'alter table posts add constraint posts_poll_options_size check (poll_options is null or (jsonb_typeof(poll_options) = ''array'' and jsonb_array_length(poll_options) <= 6 and pg_column_size(poll_options) <= 4000))';

  -- Brzda proti zahlcení: nejvýš 3 příspěvky za minutu a 20 za hodinu (a čas zápisu určuje databáze).
  if to_regproc('public.kine_limit_rate') is not null then
    execute 'drop trigger if exists kine_limit_posts on posts';
    execute 'create trigger kine_limit_posts before insert on posts for each row execute function kine_limit_rate(''owner_id'', ''3'', ''20'')';
  else
    raise notice 'C) brzda příspěvků přeskočena: chybí kine_limit_rate (migrace bezpecnost-rijen).';
  end if;

  -- Příspěvky jen pro členy kanálu - jen když existují členství (peníze pro tvůrce).
  if to_regclass('public.channel_subscriptions') is null then
    raise notice 'C) příspěvky pro členy přeskočeny: chybí channel_subscriptions (supabase-migration-creator-subscriptions.sql). Po jejím spuštění pusť tenhle soubor znovu.';
    return;
  end if;

  execute 'alter table posts add column if not exists members_only boolean not null default false';
  -- Anketa jen pro členy ne (hlasuje se funkcí mimo pravidla viditelnosti).
  execute 'alter table posts drop constraint if exists posts_members_only_no_poll';
  execute 'alter table posts add constraint posts_members_only_no_poll check (not members_only or type <> ''poll'')';

  -- Tým Kine: správce (is_admin) a s migrací rolí i moderátor (sloupec role).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'role') then
    tym := '(coalesce(pr.is_admin, false) or pr.role in (''moderator'', ''admin''))';
  else
    tym := 'coalesce(pr.is_admin, false)';
  end if;
  execute format($sql$
    create or replace function kine_can_see_post(p_owner uuid, p_members_only boolean)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, pg_temp
    as $f$
      select not coalesce(p_members_only, false)
          or auth.uid() = p_owner
          or exists (
            select 1 from channel_subscriptions cs
             where cs.creator_id = p_owner and cs.subscriber_id = auth.uid() and cs.status in ('active', 'past_due')
          )
          or exists (select 1 from profiles pr where pr.id = auth.uid() and %s);
    $f$
  $sql$, tym);
  execute 'grant execute on function kine_can_see_post(uuid, boolean) to anon, authenticated, service_role';

  -- Kdo příspěvek vidí: veřejné všichni, pro členy jen členové, autor a tým Kine.
  -- Pravidla pro čtení se OR-ují - kdyby zůstalo jakékoli staré "vidí všichni" (třeba
  -- založené ručně v Supabase pod jiným názvem), příspěvky pro členy by viděl každý.
  -- Proto pryč všechna dosavadní pravidla pro čtení příspěvků, ať se jmenují jakkoli.
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'posts' and cmd = 'SELECT' loop
    execute format('drop policy %I on posts', pol.policyname);
  end loop;
  execute 'create policy "Příspěvky vidí každý, pro členy jen členové" on posts for select using (kine_can_see_post(owner_id, members_only))';

  -- Komentáře pod příspěvkem pro členy: číst a psát jen ten, kdo příspěvek vidí
  -- (stejně tak pryč všechna dosavadní pravidla pro čtení a psaní komentářů).
  if to_regclass('public.comments') is not null then
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'comments' and cmd in ('SELECT', 'INSERT') loop
      execute format('drop policy %I on comments', pol.policyname);
    end loop;
    execute 'create policy "Komentáře čte každý, u členských příspěvků jen člen" on comments for select using (post_id is null or exists (select 1 from posts p where p.id = comments.post_id))';
    execute 'create policy "Přihlášený komentuje, u příspěvků pro členy jen člen" on comments for insert with check (auth.uid() = user_id and (post_id is null or exists (select 1 from posts p where p.id = comments.post_id)))';
  end if;

  -- Počet příspěvků pro členy (zamčená dlaždice „N příspěvků jen pro členy“ - bez obsahu).
  execute $sql$
    create or replace function members_only_post_count(p_owner uuid)
    returns int
    language sql
    stable
    security definer
    set search_path = public, pg_temp
    as $f$
      select count(*)::int from posts where owner_id = p_owner and members_only;
    $f$
  $sql$;
  execute 'grant execute on function members_only_post_count(uuid) to anon, authenticated, service_role';
end $mig$;

notify pgrst, 'reload schema';

-- Kontrola: co v databázi je (true = hotovo).
select
  to_regclass('public.kine_user_locks') is not null as zamky,
  to_regclass('public.live_sessions') is not null as statistiky_vysilani,
  exists (select 1 from information_schema.columns where table_name = 'posts' and column_name = 'members_only') as prispevky_pro_cleny;
