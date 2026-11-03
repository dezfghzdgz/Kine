-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table videos add column if not exists custom_thumbnail boolean default false;

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;

do $$ begin
  -- POZOR (soukromí, listopad 2026): náhledy se zobrazují přes veřejnou adresu
  -- i bez tohoto pravidla. SELECT řídí jen výpis souborů (list) - jen vlastní
  -- složka, jinak si kdokoli vypíše náhledy soukromých videí
  -- (viz supabase-migration-bezpecnost-listopad.sql, M4). Dřív veřejné čtení.
  create policy "Náhledy jsou veřejně viditelné" on storage.objects for select to authenticated using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává náhled jen do své složky" on storage.objects for insert
    with check (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel přepisuje jen svůj náhled" on storage.objects for update
    using (bucket_id = 'thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
