-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- Statistiky "odkud diváci přicházejí".
--
-- Ke každému zhlédnutí si appka poznamená, odkud se na video kliklo -
-- jestli z hlavní stránky, z hledání, z playlistu, z odběrů, nebo z jiného
-- webu. Ukládá se jen krátký název místa nebo doména (např. "search",
-- "playlist", "youtube.com"), nikdy celá adresa - v té by mohla být
-- i hledaná fráze a další věci, po kterých tvůrci nic není.
--
-- U zhlédnutí zapsaných dřív zůstane sloupec prázdný a statistiky je
-- ukážou jako "Neznámé".

alter table views_log add column if not exists source text;

-- Statistiky se ptají "všechna zhlédnutí těchhle videí, seskupeně podle
-- zdroje" - tenhle index na to stačí.
create index if not exists idx_views_log_video_source on views_log (video_id, source);

-- A tenhle zrychlí grafy v čase (zhlédnutí po dnech a hodinách).
create index if not exists idx_views_log_video_time on views_log (video_id, viewed_at);


-- ---------------------------------------------------------------------------
-- Doba sledování a dokoukanost pro statistiky kanálu
-- ---------------------------------------------------------------------------
--
-- Rozkoukanost videí (watch_history) je schválně soukromá - každý vidí jen
-- svoje řádky. Tvůrce se tak k datům o svých videích normálním dotazem
-- nedostane a statistiky by mu vycházely nulové.
--
-- Řeší to tyhle dvě funkce: běží s právy databáze, ale vrací jen SOUČTY za
-- video, nikdy jednotlivé řádky ani to, kdo co sledoval. Tvůrce se dozví
-- "tohle video lidi dokoukají ze 68 %", ne "tenhle člověk skončil v 0:42".
-- A ptát se smí jen na videa, která jsou opravdu jeho (nebo je u nich
-- potvrzený jako spolutvůrce).

create or replace function creator_video_stats(video_ids uuid[])
returns table (
  video_id uuid,
  comment_count bigint,
  watch_rows bigint,
  finished_rows bigint,
  watch_seconds bigint,
  completion_sum numeric,
  completion_rows bigint
)
language sql
security definer
set search_path = public
as $$
  with allowed as (
    select v.id, coalesce(v.duration_seconds, 0) as duration_seconds
    from videos v
    where v.id = any(video_ids)
      and (
        v.owner_id = auth.uid()
        or exists (
          select 1 from video_collaborators c
          where c.video_id = v.id and c.profile_id = auth.uid() and c.status = 'accepted'
        )
      )
  )
  select
    a.id,
    (select count(*) from comments c where c.video_id = a.id),
    (select count(*) from watch_history w where w.video_id = a.id),
    (select count(*) from watch_history w where w.video_id = a.id and w.completed),
    coalesce((select sum(w.progress_seconds) from watch_history w where w.video_id = a.id), 0),
    case when a.duration_seconds > 0 then coalesce((
      select sum(least(w.progress_seconds::numeric / a.duration_seconds * 100, 100))
      from watch_history w where w.video_id = a.id
    ), 0) else 0 end,
    case when a.duration_seconds > 0
      then (select count(*) from watch_history w where w.video_id = a.id)
      else 0 end
  from allowed a;
$$;

create or replace function creator_unique_viewers(video_ids uuid[])
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(distinct w.user_id)
  from watch_history w
  where w.video_id in (
    select v.id from videos v
    where v.id = any(video_ids)
      and (
        v.owner_id = auth.uid()
        or exists (
          select 1 from video_collaborators c
          where c.video_id = v.id and c.profile_id = auth.uid() and c.status = 'accepted'
        )
      )
  );
$$;

revoke all on function creator_video_stats(uuid[]) from public, anon;
revoke all on function creator_unique_viewers(uuid[]) from public, anon;
grant execute on function creator_video_stats(uuid[]) to authenticated;
grant execute on function creator_unique_viewers(uuid[]) to authenticated;
