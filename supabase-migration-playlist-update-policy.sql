-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Chybělo pravidlo, které dovoluje playlisty upravovat (přejmenování, barva náhledu).

do $$ begin
  create policy "Uživatel upravuje jen svoje playlisty" on playlists for update
  using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
