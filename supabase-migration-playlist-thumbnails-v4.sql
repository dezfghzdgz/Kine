-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Kompletně od nuly - smažeme bucket i všechna pravidla a založíme znovu
-- s naprosto jednoduchým nastavením, ať jednou provždy zjistíme, jestli
-- šlo o pravidla, nebo o něco jiného.

delete from storage.objects where bucket_id = 'playlist-thumbnails';
delete from storage.buckets where id = 'playlist-thumbnails';

insert into storage.buckets (id, name, public, file_size_limit)
values ('playlist-thumbnails', 'playlist-thumbnails', true, 5242880);

drop policy if exists "Náhledy playlistů jsou veřejně viditelné" on storage.objects;
drop policy if exists "Uživatel nahrává náhled jen do své složky" on storage.objects;
drop policy if exists "Uživatel přepisuje jen svůj náhled playlistu" on storage.objects;
drop policy if exists "Náhledy playlistů jsou veřejně viditelné 2" on storage.objects;
drop policy if exists "Uživatel nahrává náhled playlistu 2" on storage.objects;
drop policy if exists "Uživatel přepisuje náhled playlistu 2" on storage.objects;
drop policy if exists "playlist_thumbnails_select_v3" on storage.objects;
drop policy if exists "playlist_thumbnails_insert_v3" on storage.objects;
drop policy if exists "playlist_thumbnails_update_v3" on storage.objects;

create policy "playlist_thumbnails_all_v4"
on storage.objects for all
using (bucket_id = 'playlist-thumbnails')
with check (bucket_id = 'playlist-thumbnails');
