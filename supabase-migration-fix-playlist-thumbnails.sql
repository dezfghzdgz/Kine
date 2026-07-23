-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Tohle přepíše nastavení úložiště pro náhledy playlistů od nuly,
-- pro případ, že se předtím vytvořilo nesprávně (např. jako neveřejné).

update storage.buckets set public = true where id = 'playlist-thumbnails';
insert into storage.buckets (id, name, public)
values ('playlist-thumbnails', 'playlist-thumbnails', true)
on conflict (id) do update set public = true;

drop policy if exists "Náhledy playlistů jsou veřejně viditelné" on storage.objects;
drop policy if exists "Uživatel nahrává náhled jen do své složky" on storage.objects;
drop policy if exists "Uživatel přepisuje jen svůj náhled playlistu" on storage.objects;

create policy "Náhledy playlistů jsou veřejně viditelné 2"
on storage.objects for select using (bucket_id = 'playlist-thumbnails');

create policy "Uživatel nahrává náhled playlistu 2"
on storage.objects for insert
with check (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Uživatel přepisuje náhled playlistu 2"
on storage.objects for update
using (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
