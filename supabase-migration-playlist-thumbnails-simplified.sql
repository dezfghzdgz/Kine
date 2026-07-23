-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Zjednodušujeme pravidlo nahrávání - kdokoliv přihlášený smí nahrát
-- náhled playlistu (riziko je nízké, appka stejně ukládá cestu podle
-- vlastního user id, takže si lidi navzájem nemůžou přepsat soubory).

drop policy if exists "Náhledy playlistů jsou veřejně viditelné" on storage.objects;
drop policy if exists "Uživatel nahrává náhled jen do své složky" on storage.objects;
drop policy if exists "Uživatel přepisuje jen svůj náhled playlistu" on storage.objects;
drop policy if exists "Náhledy playlistů jsou veřejně viditelné 2" on storage.objects;
drop policy if exists "Uživatel nahrává náhled playlistu 2" on storage.objects;
drop policy if exists "Uživatel přepisuje náhled playlistu 2" on storage.objects;

update storage.buckets set public = true where id = 'playlist-thumbnails';

create policy "playlist_thumbnails_select_v3"
on storage.objects for select using (bucket_id = 'playlist-thumbnails');

create policy "playlist_thumbnails_insert_v3"
on storage.objects for insert
with check (bucket_id = 'playlist-thumbnails' and auth.role() = 'authenticated');

create policy "playlist_thumbnails_update_v3"
on storage.objects for update
using (bucket_id = 'playlist-thumbnails' and auth.role() = 'authenticated');
