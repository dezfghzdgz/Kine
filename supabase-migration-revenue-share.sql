-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- Rozdělení výdělků mezi tvůrce a Kine
--
-- Každý tvůrce má procento, které z výdělku dostává on; zbytek jde
-- platformě. Nováček startuje na 25 % (Kine 75 %), po dosažení cíle se
-- posouvá na 55 % (Kine 45 %). Moderátor může u kohokoliv nastavit
-- vlastní procento - pro speciální partnery nahoru, jako sankci dolů.
--
-- Procento si NIKDO nemůže přepsat sám: mění se jen přes naše
-- /api/admin/... endpointy (service role), stejně jako ověření kanálu.
-- Hlídá to spouštěč protect_admin_fields níž.
--
-- Nový typ oznámení "view_milestone" (video překročilo kulatý počet
-- zhlédnutí) je tu taky, ať se dá v seznamu oznámení barevně odlišit.

alter table profiles add column if not exists revenue_share_percent int not null default 25
  check (revenue_share_percent between 0 and 100);

alter table profiles add column if not exists partner_status text not null default 'standard'
  check (partner_status in ('standard', 'partner', 'sanctioned'));

-- Krátká poznámka moderátora, proč je procento jiné než výchozí.
alter table profiles add column if not exists revenue_share_note text;

-- Sáhl už do podílu moderátor ručně?
--   false = podíl se řídí sám podle počtu odběratelů (stupně výš)
--   true  = platí přesně to, co nastavil moderátor (partner i sankce)
alter table profiles add column if not exists revenue_share_manual boolean not null default false;


-- Rozšíření spouštěče, který chrání citlivé údaje profilu. Kromě is_admin
-- a verification_tier teď hlídá i podíl z výdělků, stav partnerství
-- a poznámku - aby si je uživatel nemohl z prohlížeče přepsat sám.
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
    if new.revenue_share_percent is distinct from old.revenue_share_percent then
      new.revenue_share_percent := old.revenue_share_percent;
    end if;
    if new.partner_status is distinct from old.partner_status then
      new.partner_status := old.partner_status;
    end if;
    if new.revenue_share_note is distinct from old.revenue_share_note then
      new.revenue_share_note := old.revenue_share_note;
    end if;
    if new.revenue_share_manual is distinct from old.revenue_share_manual then
      new.revenue_share_manual := old.revenue_share_manual;
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


-- Počítání zhlédnutí bez ztrát.
--
-- Dřív si appka přečetla počet zhlédnutí, přičetla jedničku a uložila to
-- zpátky. Když přišli dva diváci ve stejnou chvíli, oba přečetli stejné
-- číslo a jedno zhlédnutí se ztratilo (a milníkové oznámení přišlo dvakrát).
-- Tahle funkce přičte jedničku přímo v databázi a vrátí výsledek, takže se
-- souběžné požadavky nemůžou přebít.
create or replace function increment_video_views(target_video_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update videos set views = coalesce(views, 0) + 1
  where id = target_video_id
  returning views;
$$;

-- Volat ji smí jen náš server (service role), ne prohlížeč - jinak by si
-- kdokoliv mohl nafouknout počet zhlédnutí u libovolného videa.
revoke all on function increment_video_views(uuid) from public, anon, authenticated;
grant execute on function increment_video_views(uuid) to service_role;


-- Milníky zhlédnutí jako nový druh oznámení.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'view_milestone', 'donation',
                  'subscription', 'new_video', 'comment_reply', 'moderation_warning'));
