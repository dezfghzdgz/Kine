-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Zkoušíme úplně nový název úložiště, pro případ, že to staré má
-- nějaký neviditelný problém, který se nedaří opravit na místě.

insert into storage.buckets (id, name, public, file_size_limit)
values ('playlist-covers', 'playlist-covers', true, 5242880)
on conflict (id) do update set public = true;

create policy "playlist_covers_all"
on storage.objects for all
using (bucket_id = 'playlist-covers')
with check (bucket_id = 'playlist-covers');
