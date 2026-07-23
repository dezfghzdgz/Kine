-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table profiles add column if not exists banner_url text;
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists social_links jsonb default '[]';

insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

do $$ begin
  create policy "Bannery jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'banners');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává jen svůj banner" on storage.objects for insert
    with check (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj banner" on storage.objects for update
    using (bucket_id = 'banners' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
