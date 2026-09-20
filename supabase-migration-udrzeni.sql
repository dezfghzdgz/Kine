-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- KŘIVKA UDRŽENÍ DIVÁKŮ (statistiky kanálu, lib/retention.ts)
--
-- Tvůrce vidí, kam se jeho diváci ve videu dostali - v které minutě
-- odpadají. Historie sledování (watch_history) je soukromá: každý vidí
-- jen svoji. Tahle funkce tvůrci (nebo přijatému spolutvůrci) vydá
-- POUZE pozice, bez toho, kdo to byl - žádná id uživatelů, žádné časy.
-- Stejný vzor jako creator_video_stats (supabase-migration-view-sources.sql).

create or replace function creator_video_progress(video uuid)
returns table (progress_seconds int, completed boolean)
language sql
security definer
set search_path = public
as $$
  select w.progress_seconds::int, coalesce(w.completed, false)
  from watch_history w
  where w.video_id = video
    and exists (
      select 1 from videos v
      where v.id = video
        and (
          v.owner_id = auth.uid()
          or exists (
            select 1 from video_collaborators c
            where c.video_id = v.id and c.profile_id = auth.uid() and c.status = 'accepted'
          )
        )
    )
  limit 20000;
$$;

revoke all on function creator_video_progress(uuid) from public, anon;
grant execute on function creator_video_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
