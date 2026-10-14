-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- ODZNAKY: výběr na kanál jde uložit, speciální a VLASTNÍ odznaky od týmu Kine
--
-- 1) profiles.badge_showcase / badges_seen - výběr odznaků na kanál (a o kterých
--    odznacích už tvůrce ví). Jsou i v supabase-migration-odznaky.sql; tady pro
--    jistotu znovu - bez nich se výběr "nedal uložit".
-- 2) Oznámení druhu "badge" (a všechny dřívější druhy).
-- 3) profile_special_badges - speciální odznaky (Majitel, Vývojář, Tým Kine,
--    Moderátor, Beta tester, Partner, Lovec chyb); i v zive-odznaky, pro jistotu.
-- 4) custom_badges + profile_custom_badges - VLASTNÍ odznaky: moderátor nebo
--    správce si na /admin/badges vytvoří odznak (název, popis, ikona, barva,
--    vlastní obrázek nebo GIF) a přidělí ho komu chce. Vidí je každý,
--    zapisuje jen server - sám si odznak nikdo nedá.
-- 5) Moderátor, který upravuje cizí profil (zablokování), mu nezmění výběr odznaků.
-- 6) Účtu "bezejmena" odznak Majitel Kine.
--
-- Bez skriptu web funguje dál, jen bez vlastních odznaků (a bez výběru na
-- kanál, když chyběla i migrace odznaky). Skript jde spustit i víckrát.

-- 1) Výběr odznaků na kanál ----------------------------------------------------
alter table profiles add column if not exists badge_showcase text[];
alter table profiles add column if not exists badges_seen text[];
-- Výběr je veřejný (vidí ho každý na kanálu); badges_seen zůstává jen pro server.
grant select (badge_showcase) on profiles to anon, authenticated;

-- 2) Oznámení o odznaku (seznam druhů = všechny, které Kine posílá) ------------
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'view_milestone', 'donation',
                  'subscription', 'new_video', 'new_post', 'comment_reply', 'moderation_warning', 'live', 'badge'));

-- 3) Speciální odznaky ---------------------------------------------------------
create table if not exists profile_special_badges (
  profile_id uuid not null references profiles(id) on delete cascade,
  badge text not null,
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, badge)
);
alter table profile_special_badges drop constraint if exists profile_special_badges_badge_check;
alter table profile_special_badges add constraint profile_special_badges_badge_check
  check (badge in ('owner', 'dev', 'team', 'moderator', 'betaTester', 'partner', 'bugHunter'));
alter table profile_special_badges enable row level security;
drop policy if exists "Speciální odznaky vidí každý" on profile_special_badges;
create policy "Speciální odznaky vidí každý" on profile_special_badges for select using (true);
revoke insert, update, delete on profile_special_badges from anon, authenticated;
grant select on profile_special_badges to anon, authenticated;

-- 4) Vlastní odznaky -----------------------------------------------------------
create table if not exists custom_badges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon text not null default 'starFilled',
  color text not null default '#a855f7',
  image_url text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table custom_badges drop constraint if exists custom_badges_name_check;
alter table custom_badges add constraint custom_badges_name_check check (char_length(btrim(name)) between 1 and 32);
alter table custom_badges drop constraint if exists custom_badges_description_check;
alter table custom_badges add constraint custom_badges_description_check check (description is null or char_length(description) <= 160);
alter table custom_badges drop constraint if exists custom_badges_icon_check;
alter table custom_badges add constraint custom_badges_icon_check check (icon ~ '^[a-zA-Z]{1,24}$');
alter table custom_badges drop constraint if exists custom_badges_color_check;
alter table custom_badges add constraint custom_badges_color_check check (color ~ '^#[0-9a-fA-F]{6}$');
alter table custom_badges drop constraint if exists custom_badges_image_check;
alter table custom_badges add constraint custom_badges_image_check check (image_url is null or image_url ~ '^https://');

create table if not exists profile_custom_badges (
  profile_id uuid not null references profiles(id) on delete cascade,
  badge_id uuid not null references custom_badges(id) on delete cascade,
  granted_by uuid references profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, badge_id)
);
create index if not exists profile_custom_badges_badge_idx on profile_custom_badges (badge_id);

alter table custom_badges enable row level security;
alter table profile_custom_badges enable row level security;
drop policy if exists "Vlastní odznaky vidí každý" on custom_badges;
create policy "Vlastní odznaky vidí každý" on custom_badges for select using (true);
drop policy if exists "Přidělené vlastní odznaky vidí každý" on profile_custom_badges;
create policy "Přidělené vlastní odznaky vidí každý" on profile_custom_badges for select using (true);
revoke insert, update, delete on custom_badges from anon, authenticated;
revoke insert, update, delete on profile_custom_badges from anon, authenticated;
grant select on custom_badges to anon, authenticated;
grant select on profile_custom_badges to anon, authenticated;

-- 5) Cizí výběr odznaků nemění nikdo jiný než majitel (a server) ----------------
create or replace function protect_badge_fields()
returns trigger as $$
begin
  -- Jen přihlášený uživatel (ne server, ne SQL Editor) u cizího profilu.
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is not null and auth.uid() <> old.id then
    new.badge_showcase := old.badge_showcase;
    new.badges_seen := old.badges_seen;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_protect_badge_fields on profiles;
create trigger trg_protect_badge_fields
  before update on profiles
  for each row execute function protect_badge_fields();

-- 6) Majitel Kine pro účet "bezejmena" ------------------------------------------
insert into profile_special_badges (profile_id, badge)
select id, 'owner' from profiles where lower(username) = 'bezejmena'
on conflict (profile_id, badge) do nothing;

do $$ begin
  if not exists (select 1 from profiles where lower(username) = 'bezejmena') then
    raise notice 'Účet "bezejmena" jsem nenašel - odznak Majitel Kine si přiděl na /admin/badges.';
  end if;
end $$;
