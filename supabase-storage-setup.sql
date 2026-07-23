-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Vytvoří úložiště pro profilové fotky a nastaví, kdo smí co nahrávat/mazat.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Kdokoliv může vidět profilové fotky (jsou veřejné, jako na YouTube)
create policy "Avatary jsou veřejně viditelné"
on storage.objects for select
using (bucket_id = 'avatars');

-- Přihlášený uživatel může nahrát jen svoji vlastní fotku (soubor pojmenovaný podle jeho user id)
create policy "Uživatel nahrává jen svůj avatar"
on storage.objects for insert
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Uživatel přepisuje jen svůj avatar"
on storage.objects for update
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Uživatel maže jen svůj avatar"
on storage.objects for delete
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
