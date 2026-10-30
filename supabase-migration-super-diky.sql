-- =====================================================================
-- Super díky pod videi (Super Thanks): divák pošle tvůrci částku a vzkaz
-- k jednomu videu, vzkaz se ukáže zvýrazněný pod videem.
--
-- Používá stejnou tabulku jako podpory ve vysílání (live_tips) - jen navíc
-- s odkazem na video. Napřed musí proběhnout supabase-migration-podpory-kontrola.sql
-- (tabulka live_tips). Spustit v Supabase -> SQL Editor. Jde pustit víckrát.
-- =====================================================================

do $mig$
begin
  if to_regclass('public.live_tips') is null then
    raise exception 'Chybí tabulka live_tips - napřed spusť supabase-migration-podpory-kontrola.sql, pak tenhle soubor znovu.';
  end if;
  if to_regclass('public.videos') is null then
    raise exception 'Chybí tabulka videos.';
  end if;

  -- K jakému videu Super díky patří (null = podpora ve vysílání).
  alter table live_tips add column if not exists video_id uuid references videos(id) on delete set null;
  -- Skrytý vzkaz (tvůrce videa / moderátor) - pod videem se neukazuje.
  alter table live_tips add column if not exists hidden_at timestamptz;
  create index if not exists live_tips_video_idx on live_tips (video_id, paid_at desc) where video_id is not null;
end $mig$;

notify pgrst, 'reload schema';

-- Kontrola: má vypsat dva řádky (video_id, hidden_at).
select column_name, data_type from information_schema.columns where table_name = 'live_tips' and column_name in ('video_id', 'hidden_at');
