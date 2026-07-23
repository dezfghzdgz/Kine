-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table playlist_videos add column if not exists position int default 0;
alter table playlists add column if not exists thumbnail_url text;

insert into storage.buckets (id, name, public)
values ('playlist-thumbnails', 'playlist-thumbnails', true)
on conflict (id) do nothing;

do $$ begin
  create policy "Náhledy playlistů jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'playlist-thumbnails');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává náhled jen do své složky" on storage.objects for insert
    with check (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj náhled playlistu" on storage.objects for update
    using (bucket_id = 'playlist-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
