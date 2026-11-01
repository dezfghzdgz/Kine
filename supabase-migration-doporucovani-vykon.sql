-- =====================================================================
-- Kine 0138: lepší doporučování, rychlejší statistiky, úklid osobních údajů
--
-- Spusť CELÉ v Supabase -> SQL Editor. Jde pouštět opakovaně (nic nemaže
-- kromě starých záznamů popsaných v části C).
-- Na konci tabulka: zhlednuti / doporucovani / statistiky / uklid = true.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Co mělo přidat pár starších migrací (když neproběhly, doplní se tady)
-- ---------------------------------------------------------------------
-- views_log.ip_address (supabase-migration-view-abuse-protection.sql) v databázi
-- chyběl - server pak zhlédnutí do views_log vůbec nezapsal (zápis s IP adresou
-- spadl) a statistiky "odkud diváci přicházejí" / "kdy se dívají" zůstávaly prázdné.
-- Spolu s ním zdroj a zařízení zhlédnutí, rozkoukanost a tabulka pokusů o přihlášení.

alter table views_log add column if not exists ip_address text;
alter table views_log add column if not exists source text;
alter table views_log add column if not exists device text;
create index if not exists idx_views_log_video_ip_time on views_log (video_id, ip_address, viewed_at);
create index if not exists idx_views_log_video_time on views_log (video_id, viewed_at);
create index if not exists idx_views_log_video_source on views_log (video_id, source);

alter table watch_history add column if not exists progress_seconds integer default 0;
alter table watch_history add column if not exists completed boolean default false;

create table if not exists login_attempt_ip_log (
  id uuid default gen_random_uuid() primary key,
  ip_address text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempt_ip_time on login_attempt_ip_log (ip_address, created_at);
alter table login_attempt_ip_log enable row level security;

-- IP adresu zhlédnutí z prohlížeče nikdo nepřečte (zbytek řádku jen majitel videa
-- kvůli statistikám) a zapisuje jen server - stejně jako supabase-migration-privacy-fixes.sql
-- a supabase-migration-zabezpeceni-a-limity.sql (kdyby neproběhly).
do $mig$
declare
  verejne text;
  pol record;
begin
  select coalesce(string_agg(quote_ident(column_name), ', '), 'id')
    into verejne
    from information_schema.columns
   where table_schema = 'public' and table_name = 'views_log' and column_name <> 'ip_address';
  execute 'revoke select, insert, update, delete on views_log from anon, authenticated';
  execute format('grant select (%s) on views_log to authenticated', verejne);
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'views_log'
       and (cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') or policyname = 'Views log je veřejně čitelný')
  loop
    execute format('drop policy %I on views_log', pol.policyname);
  end loop;
  execute 'drop policy if exists "Zhlédnutí vidí jen majitel videa" on views_log';
  execute 'create policy "Zhlédnutí vidí jen majitel videa" on views_log
             for select to authenticated
             using (exists (select 1 from videos v where v.id = views_log.video_id and v.owner_id = auth.uid()))';
end $mig$;

-- ---------------------------------------------------------------------
-- A) Doporučování: kvalita videa (jak moc ho lidé dokoukávají a hodnotí)
-- ---------------------------------------------------------------------
-- videos.engagement = 0 až 1 (0.5 = průměr). Počítá ho denní úklid
-- (/api/videos/sweep -> refresh_video_engagement) z rozkoukanosti
-- (watch_history) a hodnocení (video_reactions). Hlavní stránka podle něj
-- posouvá videa, která lidi opravdu baví, nahoru - ne jen ta s nejvíc
-- kliky. Málo dat = blízko průměru (jedno zhlédnutí nic nerozhodne).

alter table videos add column if not exists engagement real;

-- Kvalitu si tvůrce nesmí přepsat sám (update vlastního videa jinak RLS dovolí).
create or replace function protect_video_engagement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and coalesce(auth.role(), '') <> 'service_role'
     and new.engagement is distinct from old.engagement then
    new.engagement := old.engagement;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_video_engagement on videos;
create trigger trg_protect_video_engagement
  before update of engagement on videos
  for each row execute function protect_video_engagement();

-- Přepočet kvality u videí, u kterých se za posledních p_days dní něco dělo.
-- Vrací, u kolika videí se hodnota změnila. Sloupce ze starších migrací
-- (rozkoukanost, hvězdičky) se berou, jen když v databázi jsou.
create or replace function refresh_video_engagement(p_days int default 60)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer := 0;
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 3650)));
  has_progress boolean;
  has_completed boolean;
  has_score boolean;
  watch_expr text;
  watch_filter text;
  score_expr text;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'watch_history' and column_name = 'progress_seconds') into has_progress;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'watch_history' and column_name = 'completed') into has_completed;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'video_reactions' and column_name = 'score') into has_score;
  -- Jen řádky, u kterých je rozkoukanost známá (starší řádky bez ní by vypadaly
  -- jako "nikdo nedokoukal" a populární videa by vyšla hůř).
  watch_expr := case
    when has_progress and has_completed then 'case when wh.completed then 1.0 else least(1.0, greatest(0, coalesce(wh.progress_seconds, 0))::float / v.duration_seconds) end'
    when has_progress then 'least(1.0, greatest(0, coalesce(wh.progress_seconds, 0))::float / v.duration_seconds)'
    else '0.45'
  end;
  watch_filter := case
    when has_progress and has_completed then '(coalesce(wh.progress_seconds, 0) > 0 or coalesce(wh.completed, false))'
    when has_progress then 'coalesce(wh.progress_seconds, 0) > 0'
    else 'false'
  end;
  score_expr := case
    when has_score then 'coalesce(r.score, case when r.reaction = ''like'' then 5 else 1 end)'
    else 'case when r.reaction = ''like'' then 5 else 1 end'
  end;

  execute format($q$
    with active as (
      select video_id from watch_history where watched_at > $1
      union
      select video_id from video_reactions where created_at > $1
    ),
    watch as (
      select wh.video_id, count(*)::float as n, sum(%1$s) as s
        from watch_history wh
        join videos v on v.id = wh.video_id
       where wh.video_id in (select video_id from active)
         and coalesce(v.duration_seconds, 0) > 0
         -- Tvůrce si kvalitu nenafoukne sledováním vlastního videa.
         and wh.user_id is distinct from v.owner_id
         and %3$s
       group by wh.video_id
    ),
    rating as (
      select r.video_id, count(*)::float as n, sum((least(5, greatest(1, %2$s)) - 1) / 4.0) as s
        from video_reactions r
        join videos v on v.id = r.video_id
       where r.video_id in (select video_id from active)
         and r.user_id is distinct from v.owner_id
       group by r.video_id
    ),
    calc as (
      -- Průměr s "rozumným odhadem" (8 zhlédnutí po 45 %%, 5 hodnocení po 70 %%):
      -- nové video s jedním zhlédnutím tak neskočí na 0 ani na 1.
      select a.video_id,
             round((0.65 * ((coalesce(w.s, 0) + 0.45 * 8) / (coalesce(w.n, 0) + 8))
                  + 0.35 * ((coalesce(r.s, 0) + 0.70 * 5) / (coalesce(r.n, 0) + 5)))::numeric, 3)::real as e
        from active a
        left join watch w on w.video_id = a.video_id
        left join rating r on r.video_id = a.video_id
    )
    update videos v
       set engagement = c.e
      from calc c
     where v.id = c.video_id
       and v.engagement is distinct from c.e
  $q$, watch_expr, score_expr, watch_filter) using since;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke execute on function refresh_video_engagement(int) from public, anon, authenticated;
grant execute on function refresh_video_engagement(int) to service_role;

-- Indexy pro nové dotazy hlavní stránky (videa odebíraných kanálů, nejlépe
-- hodnocená) a pro přepočet kvality.
create index if not exists idx_videos_owner_created on videos (owner_id, created_at desc);
create index if not exists idx_videos_engagement on videos (engagement desc)
  where status = 'ready' and visibility = 'public' and engagement is not null;
create index if not exists idx_watch_history_video on watch_history (video_id);
create index if not exists idx_watch_history_watched on watch_history (watched_at desc);
create index if not exists idx_video_reactions_created on video_reactions (created_at desc);

-- První výpočet hned (celá historie) - doporučování to umí od první minuty.
select refresh_video_engagement(3650) as videa_s_kvalitou;


-- ---------------------------------------------------------------------
-- B) Statistiky kanálu: souhrn zhlédnutí v databázi
-- ---------------------------------------------------------------------
-- Stránka statistik dřív stahovala KAŽDÉ zhlédnutí zvlášť, po tisíci
-- (kanál se 100 000 zhlédnutími = 100 dotazů za sebou a desítky MB).
-- Tahle funkce vrátí jen součty: po dnech, mřížku den x hodina (v časovém
-- pásmu diváka statistik) a zdroje. Jen pro vlastní videa volajícího.

create or replace function creator_views_summary(video_ids uuid[], p_tz text default 'UTC')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  tz text := coalesce(nullif(p_tz, ''), 'UTC');
  src text;
  result jsonb;
begin
  if me is null or video_ids is null then
    return null;
  end if;
  begin
    perform now() at time zone tz;
  exception when others then
    tz := 'UTC';
  end;
  -- Zdroj zhlédnutí přidala starší migrace - bez něj "unknown".
  src := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'views_log' and column_name = 'source')
              then 'l.source' else 'null::text' end;

  execute format($q$
    with mine as (
      select v.id from videos v
       where v.id = any ($1[1:5000])
         and v.owner_id = $2
    ),
    views as (
      select l.viewed_at at time zone $3 as local_at, %s as source
        from views_log l
        join mine m on m.id = l.video_id
    )
    select jsonb_build_object(
      'total', (select count(*) from views),
      'daily', coalesce((
        select jsonb_agg(jsonb_build_array(to_char(d, 'YYYY-MM-DD'), n) order by d)
          from (select local_at::date as d, count(*) as n from views group by 1) x), '[]'::jsonb),
      'heatmap', coalesce((
        select jsonb_agg(jsonb_build_array(dow, h, n))
          from (select extract(isodow from local_at)::int as dow, extract(hour from local_at)::int as h, count(*) as n
                  from views group by 1, 2) y), '[]'::jsonb),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_array(s, n))
          from (select coalesce(source, 'unknown') as s, count(*) as n from views group by 1) z), '[]'::jsonb)
    )
  $q$, src) into result using video_ids, me, tz;
  return result;
end;
$$;
revoke execute on function creator_views_summary(uuid[], text) from public, anon;
grant execute on function creator_views_summary(uuid[], text) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- C) Úklid osobních údajů (denně z /api/videos/sweep)
-- ---------------------------------------------------------------------
--  - IP adresy u zhlédnutí jen 30 dní (proti nafukování zhlédnutí stačí
--    pár hodin); samotné zhlédnutí bez IP zůstává kvůli statistikám kanálu,
--  - hlášení chyb z prohlížečů 30 dní,
--  - IP adresy pokusů o přihlášení 2 dny (limit se počítá za hodinu).
-- Po dávkách, ať jeden běh nezatíží databázi.

create index if not exists idx_views_log_ip_pending on views_log (viewed_at) where ip_address is not null;

create or replace function kine_prune_logs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ips integer := 0;
  errors integer := 0;
  logins integer := 0;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'views_log' and column_name = 'ip_address') then
    execute $q$
      update views_log set ip_address = null
       where id in (
         select id from views_log
          where ip_address is not null and viewed_at < now() - interval '30 days'
          limit 50000
       )
    $q$;
    get diagnostics ips = row_count;
  end if;
  if to_regclass('public.client_errors') is not null then
    delete from client_errors where created_at < now() - interval '30 days';
    get diagnostics errors = row_count;
  end if;
  if to_regclass('public.login_attempt_ip_log') is not null then
    delete from login_attempt_ip_log where created_at < now() - interval '2 days';
    get diagnostics logins = row_count;
  end if;
  return jsonb_build_object('view_ips', ips, 'client_errors', errors, 'login_ips', logins);
end;
$$;
revoke execute on function kine_prune_logs() from public, anon, authenticated;
grant execute on function kine_prune_logs() to service_role;

select kine_prune_logs() as uklid_hned;

notify pgrst, 'reload schema';

-- Kontrola (true = hotovo).
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'views_log' and column_name = 'ip_address') as zhlednuti,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'videos' and column_name = 'engagement')
    and to_regprocedure('public.refresh_video_engagement(integer)') is not null as doporucovani,
  to_regprocedure('public.creator_views_summary(uuid[], text)') is not null as statistiky,
  to_regprocedure('public.kine_prune_logs()') is not null as uklid;
