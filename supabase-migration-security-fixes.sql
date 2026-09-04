-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- BEZPEČNOSTNÍ OPRAVY
--
-- Vyšlo to z kontroly celého projektu. Body 1 a 2 jsou vážné a je dobré je
-- nasadit hned; zbytek jsou chybějící politiky, kvůli kterým několik funkcí
-- v appce tiše nefunguje.

-- ---------------------------------------------------------------------
-- 1. NEJVÁŽNĚJŠÍ: podíl z výdělků si mohl kdokoliv nastavit sám
-- ---------------------------------------------------------------------
-- Tohle jsem způsobil já. Migrace s pravidly pro jména znovu vytvořila
-- funkci protect_admin_fields (create or replace) a doplnila do ní
-- username_exempt - jenže přitom vypadla pole kolem výdělků, která tam
-- přidala starší migrace. Novější verze vyhrála, takže od jejího nasazení
-- šlo z konzole prohlížeče poslat:
--
--   supabase.from('profiles').update({ revenue_share_percent: 100 }).eq('id', mojeId)
--
-- ...a mít 100 % místo 25 %. Stejně tak si šlo smazat sankci nebo poznámku
-- moderátora. Tady je funkce znovu se VŠEMI poli dohromady.

create or replace function protect_admin_fields()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    if new.is_admin is distinct from old.is_admin then
      new.is_admin := old.is_admin;
    end if;
    if new.verification_tier is distinct from old.verification_tier then
      new.verification_tier := old.verification_tier;
    end if;
    if new.username_exempt is distinct from old.username_exempt then
      new.username_exempt := old.username_exempt;
    end if;
    -- Výdělky. Měnit je smí jen /api/admin/revenue-share přes service role.
    if new.revenue_share_percent is distinct from old.revenue_share_percent then
      new.revenue_share_percent := old.revenue_share_percent;
    end if;
    if new.revenue_share_manual is distinct from old.revenue_share_manual then
      new.revenue_share_manual := old.revenue_share_manual;
    end if;
    if new.partner_status is distinct from old.partner_status then
      new.partner_status := old.partner_status;
    end if;
    if new.revenue_share_note is distinct from old.revenue_share_note then
      new.revenue_share_note := old.revenue_share_note;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_admin_fields on profiles;
create trigger trg_protect_admin_fields
before update on profiles
for each row
execute function protect_admin_fields();

-- ---------------------------------------------------------------------
-- 2. Úložiště obrázků playlistů bylo otevřené úplně komukoliv
-- ---------------------------------------------------------------------
-- Politika zněla "for all using (bucket_id = 'playlist-covers')" - bez
-- jediné zmínky o uživateli. Platila tedy i pro nepřihlášené a anon klíč
-- je ve veřejném JS. Kdokoliv mohl přepsat nebo smazat cizí obálky, nebo
-- si z bucketu udělat vlastní úložiště na tvojí doméně.
--
-- Starší migrace to měly správně (složka pojmenovaná podle uživatele),
-- verze v4 to při přepisu "od nuly" zahodila. Vracím to zpátky.

drop policy if exists "playlist_covers_all" on storage.objects;
drop policy if exists "playlist_thumbnails_all" on storage.objects;

-- Číst může kdokoliv (obálky playlistů jsou veřejné obrázky).
create policy "playlist_images_read" on storage.objects
  for select using (bucket_id in ('playlist-covers', 'playlist-thumbnails'));

-- Zapisovat, měnit a maza jen ve své vlastní složce.
create policy "playlist_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('playlist-covers', 'playlist-thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "playlist_images_update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('playlist-covers', 'playlist-thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "playlist_images_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('playlist-covers', 'playlist-thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- 3. Jedno video u Cloudflare = jeden řádek v databázi
-- ---------------------------------------------------------------------
-- Identifikátor videa u Cloudflare je vidět v odkazu přehrávače, takže si
-- ho kdokoliv přečte. Bez tohohle omezení šlo poslat cizí identifikátor do
-- /api/videos/confirm, mít pod sebou řádek streamující cizí obsah - a pak
-- ten řádek smazat, čímž se u Cloudflare smazal originál. Jediným
-- požadavkem tedy šlo nenávratně zničit cizí video.
--
-- Kdyby index nešel založit, znamená to, že takové dvojice v databázi už
-- jsou. Skript kvůli tomu nespadne, jen napíše, jak je najít.

do $$
begin
  begin
    create unique index if not exists videos_cloudflare_id_key
      on videos (cloudflare_video_id)
      where cloudflare_video_id is not null;
  exception when unique_violation then
    raise notice 'Index nelze zalozit - dve videa ukazuji na stejny obsah u Cloudflare.';
    raise notice 'Najdes je takhle:';
    raise notice 'select cloudflare_video_id, count(*), array_agg(id) from videos where cloudflare_video_id is not null group by 1 having count(*) > 1;';
  end;
end $$;

-- ---------------------------------------------------------------------
-- 4. Chybějící politiky pro úpravu (kvůli nim věci tiše nefungovaly)
-- ---------------------------------------------------------------------
-- Postgres u chybějící UPDATE politiky nevrátí chybu - prostě neupraví nic.
-- Kód si toho nevšiml a uživateli se změna ukázala, dokud stránku
-- neobnovil.

-- Zvoneček u odběru (notify_new_videos) se nikdy neuložil.
drop policy if exists "Uživatel upravuje svůj odběr" on subscriptions;
create policy "Uživatel upravuje svůj odběr" on subscriptions
  for update using (auth.uid() = subscriber_id);

-- Přepnutí palce nahoru na palec dolů u komentáře selhalo (upsert
-- potřebuje i UPDATE).
drop policy if exists "Uživatel upravuje svou reakci na komentář" on comment_reactions;
create policy "Uživatel upravuje svou reakci na komentář" on comment_reactions
  for update using (auth.uid() = user_id);

-- Totéž u příspěvků na kanálu.
drop policy if exists "Uživatel upravuje svou reakci na příspěvek" on post_reactions;
create policy "Uživatel upravuje svou reakci na příspěvek" on post_reactions
  for update using (auth.uid() = user_id);

-- Opakované stažení neaktualizovalo datum, takže se video nedostalo
-- nahoru v seznamu stažených.
drop policy if exists "Uživatel upravuje svoje stažení" on downloads;
create policy "Uživatel upravuje svoje stažení" on downloads
  for update using (auth.uid() = user_id);

-- Hlášení se nikdy neoznačilo jako vyřízené - moderátorům se fronta
-- nečistila a pracovali se seznamem, který jen roste.
drop policy if exists "Moderátor uzavírá hlášení" on reports;
create policy "Moderátor uzavírá hlášení" on reports
  for update using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and (profiles.role in ('moderator', 'admin') or profiles.is_admin)
    )
  );

-- Hlasování v anketách se neukládalo.
drop policy if exists "Přihlášený hlasuje v anketě" on posts;
create policy "Přihlášený hlasuje v anketě" on posts
  for update to authenticated using (true);

-- ---------------------------------------------------------------------
-- 5. Tvůrce si mohl přepsat počet zhlédnutí svého videa
-- ---------------------------------------------------------------------
-- RLS umí povolit nebo zakázat celý řádek, ne jednotlivé sloupce - proto
-- na to musí spouštěč. Zhlédnutí smí měnit jen funkce increment_video_views
-- a serverové endpointy.

create or replace function protect_video_counters()
returns trigger as $$
begin
  if auth.role() <> 'service_role' and new.views is distinct from old.views then
    new.views := old.views;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_video_counters on videos;
create trigger trg_protect_video_counters
before update on videos
for each row
execute function protect_video_counters();

-- ---------------------------------------------------------------------
-- 6. Dar se nezapočítá dvakrát
-- ---------------------------------------------------------------------
-- Stripe doručuje webhooky "aspoň jednou" a při chybě je opakuje. Bez
-- tohohle omezení znamenalo jedno opakované doručení dva dary v historii.

do $$
begin
  begin
    create unique index if not exists donations_stripe_session_key
      on donations (stripe_session_id)
      where stripe_session_id is not null;
  exception when unique_violation then
    raise notice 'Index nelze zalozit - v donations uz jsou zdvojene dary. Najdes je takhle:';
    raise notice 'select stripe_session_id, count(*) from donations where stripe_session_id is not null group by 1 having count(*) > 1;';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola na závěr
-- ---------------------------------------------------------------------
-- Tohle musí zůstat beze změny (spustit jako přihlášený uživatel, ne jako
-- service role):
--   update profiles set revenue_share_percent = 100 where id = auth.uid();
--   select revenue_share_percent from profiles where id = auth.uid();
--   update videos set views = 999999 where owner_id = auth.uid();
