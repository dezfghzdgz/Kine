-- Spusť v Supabase dashboardu -> SQL Editor -> New Query
--
-- SOUKROMÍ A VYNUCOVÁNÍ PRAVIDEL
--
-- Navazuje na supabase-migration-security-fixes.sql - tu spusť první.
--
-- POZOR: k téhle migraci patří i úprava kódu. Nasaď obojí naráz, jinak
-- appka přestane vidět věci, které si teď bere přímo z tabulky profiles.

-- ---------------------------------------------------------------------
-- 1. Tabulka profiles byla celá veřejně čitelná
-- ---------------------------------------------------------------------
-- Politika "for select using (true)" je z první verze appky a platí i pro
-- sloupce, které přibyly potom. Anon klíč je ve veřejném JS, takže si
-- kdokoliv mohl z konzole prohlížeče vypsat:
--
--   select id from profiles where is_shadow_banned = true   <- shadow ban k ničemu
--   select username, revenue_share_note from profiles       <- poznámky moderátora
--   select username from profiles where is_admin            <- koho napadnout
--
-- RLS umí schovat řádek, ne sloupec - na sloupce jsou práva. Řádková
-- politika zůstává, jak byla (profily jsou veřejné), jen se z citlivých
-- sloupců sundá právo číst.

revoke select on profiles from anon, authenticated;

grant select (
  id, username, display_name, avatar_url, created_at,
  banner_url, bio, social_links, verification_tier, is_supporter,
  trailer_video_id, subscription_price_eur,
  rating_mode, content_preference, disable_shorts, viewer_type
) on profiles to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Vlastní údaje si uživatel přečte přes funkci
-- ---------------------------------------------------------------------
-- Svoje vlastní nastavení (jsem admin? jaký mám podíl?) appka potřebuje.
-- Práva na sloupce jsou ale všechno nebo nic - nejde říct "jen svůj
-- řádek". Proto funkce, která schválně vrací jen řádek volajícího.

create or replace function my_account()
returns table (
  role text,
  is_admin boolean,
  is_banned boolean,
  is_shadow_banned boolean,
  payouts_suspended boolean,
  revenue_share_percent int,
  revenue_share_manual boolean,
  partner_status text,
  revenue_share_note text,
  stripe_account_id text,
  stripe_onboarding_complete boolean,
  agreed_to_rules boolean
) as $$
  select
    p.role, p.is_admin, p.is_banned, p.is_shadow_banned, p.payouts_suspended,
    p.revenue_share_percent, p.revenue_share_manual, p.partner_status,
    p.revenue_share_note, p.stripe_account_id, p.stripe_onboarding_complete,
    p.agreed_to_rules
  from profiles p
  where p.id = auth.uid();
$$ language sql security definer stable;

revoke execute on function my_account() from anon;
grant execute on function my_account() to authenticated;

-- Moderátor potřebuje vidět stav cizího kanálu. Funkce ho vydá jen tehdy,
-- když volající opravdu moderátor nebo admin je - pro ostatní vrátí prázdno.
create or replace function moderation_flags(channel_id uuid)
returns table (is_banned boolean, is_shadow_banned boolean, payouts_suspended boolean) as $$
  select p.is_banned, p.is_shadow_banned, p.payouts_suspended
  from profiles p
  where p.id = channel_id
    and exists (
      select 1 from profiles me
      where me.id = auth.uid()
        and (me.role in ('moderator', 'admin') or me.is_admin)
    );
$$ language sql security definer stable;

revoke execute on function moderation_flags(uuid) from anon;
grant execute on function moderation_flags(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Shadow ban hlídá databáze, ne prohlížeč
-- ---------------------------------------------------------------------
-- Hlavní stránka si dosud tahala seznam shadow-bannovaných a filtrovala
-- si ho sama. To znamenalo dvě věci: seznam byl veřejný (viz bod 1) a
-- filtrovalo se jen tam, kde na to někdo myslel - v Exploreru, hledání
-- ani na hashtazích ne. Teď to platí všude.
--
-- "as restrictive" znamená, že se to k dosavadním politikám přidá jako
-- další podmínka (A ZÁROVEŇ), ne jako další povolená cesta.

create or replace function owner_is_shadow_banned(owner uuid)
returns boolean as $$
  select coalesce((select p.is_shadow_banned from profiles p where p.id = owner), false);
$$ language sql security definer stable;

drop policy if exists "Shadow ban schová videa ostatním" on videos;
create policy "Shadow ban schová videa ostatním" on videos
  as restrictive for select
  using (owner_id = auth.uid() or not owner_is_shadow_banned(owner_id));

-- ---------------------------------------------------------------------
-- 4. Záznam zhlédnutí vydával IP adresy komukoliv
-- ---------------------------------------------------------------------
-- "Views log je veřejně čitelný" znamenalo, že si kdokoliv mohl stáhnout
-- IP adresy všech diváků a spárovat je s videi. To je osobní údaj.
--
-- IP adresu odteď nepřečte z prohlížeče nikdo (potřebuje ji jen serverová
-- ochrana proti nahánění zhlédnutí, a ta jede přes service role). Zbytek
-- řádku vidí jen majitel videa - kvůli statistikám kanálu.

revoke select on views_log from anon, authenticated;
grant select (id, video_id, viewed_at, source) on views_log to authenticated;

drop policy if exists "Views log je veřejně čitelný" on views_log;
create policy "Zhlédnutí vidí jen majitel videa" on views_log
  for select to authenticated
  using (exists (select 1 from videos v where v.id = views_log.video_id and v.owner_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 5. Oznámení nesmí vést mimo appku
-- ---------------------------------------------------------------------
-- Vytvořit oznámení komukoliv smí kdokoliv přihlášený - appka to tak
-- používá (lajk, odběr, odpověď). Zneužít se to dalo tím, že si útočník
-- napsal vlastní text a vlastní odkaz: "Tvůj účet bude smazán, ověř se
-- zde" s odkazem na cizí stránku. Odkaz teď musí mířit dovnitř appky,
-- takže phishing tudy neprojde.

alter table notifications drop constraint if exists notifications_link_internal;
alter table notifications add constraint notifications_link_internal
  check (link is null or link like '/%');

-- ---------------------------------------------------------------------
-- 6. Zablokovaný účet je teď opravdu zablokovaný
-- ---------------------------------------------------------------------
-- is_banned se dosud jen nastavilo a nikdo ho nečetl - zabanovaný člověk
-- dál nahrával i komentoval. Tohle mu to zatrhne přímo v databázi, takže
-- na to nemusí myslet každá stránka zvlášť.

create or replace function reject_if_banned()
returns trigger as $$
begin
  if auth.role() <> 'service_role'
     and exists (select 1 from profiles p where p.id = auth.uid() and p.is_banned) then
    raise exception 'Účet je zablokovaný.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_reject_banned_videos on videos;
create trigger trg_reject_banned_videos
before insert on videos
for each row execute function reject_if_banned();

drop trigger if exists trg_reject_banned_comments on comments;
create trigger trg_reject_banned_comments
before insert on comments
for each row execute function reject_if_banned();

drop trigger if exists trg_reject_banned_posts on posts;
create trigger trg_reject_banned_posts
before insert on posts
for each row execute function reject_if_banned();

-- ---------------------------------------------------------------------
-- Kontrola na závěr (spustit jako přihlášený uživatel, ne service role)
-- ---------------------------------------------------------------------
-- Tyhle dva musí skončit chybou "permission denied for column":
--   select is_shadow_banned from profiles limit 1;
--   select ip_address from views_log limit 1;
-- Tenhle musí projít a vrátit jeden řádek:
--   select * from my_account();
