-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table videos add column if not exists custom_thumbnail boolean default false;

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

do $$ begin
  create policy "Náhledy jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'thumbnails');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává náhled jen do své složky" on storage.objects for insert
    with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj náhled" on storage.objects for update
    using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
