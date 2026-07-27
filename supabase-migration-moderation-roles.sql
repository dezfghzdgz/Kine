-- Role uživatele (obyčejný uživatel / moderátor / admin) a příznak
-- zablokování účtu. Appka tohle na klientovi NIKDY nesmí sama měnit -
-- proto je tu i pojistka (trigger) níž.
alter table profiles add column if not exists role text not null default 'user' check (role in ('user', 'moderator', 'admin'));
alter table profiles add column if not exists is_banned boolean not null default false;

-- Pojistka: pokud by se o změnu role/zablokování pokusil běžný přihlášený
-- uživatel přes appku (ne přímo v Supabase SQL editoru), appka tu změnu
-- potichu zahodí. auth.uid() je NULL, když se příkaz spouští přímo v SQL
-- editoru nebo appku vlastním serverem (service role) - jen odtud jde
-- roli reálně změnit.
create or replace function prevent_client_role_change() returns trigger as $$
declare
  requester_role text;
begin
  if auth.uid() is not null then
    select role into requester_role from profiles where id = auth.uid();

    -- Roli (user/moderator/admin) smí přes appku měnit jen admin.
    if new.role is distinct from old.role and coalesce(requester_role, 'user') <> 'admin' then
      new.role := old.role;
    end if;

    -- Zablokování/odblokování účtu smí přes appku měnit moderátor i admin.
    if new.is_banned is distinct from old.is_banned and coalesce(requester_role, 'user') not in ('moderator', 'admin') then
      new.is_banned := old.is_banned;
    end if;

    -- Když si moderátor/admin upravuje CIZÍ profil, appka mu dovolí změnit
    -- jen roli/zablokování - všechno ostatní (jméno, popis, fotku...) se
    -- vrátí zpátky na původní hodnotu, ať to omylem/schválně nezmění.
    if auth.uid() <> old.id then
      new.username := old.username;
      new.display_name := old.display_name;
      new.avatar_url := old.avatar_url;
      new.banner_url := old.banner_url;
      new.bio := old.bio;
      new.social_links := old.social_links;
      new.content_preference := old.content_preference;
      new.rating_mode := old.rating_mode;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_client_role_change on profiles;
create trigger trg_prevent_client_role_change
  before update on profiles
  for each row execute function prevent_client_role_change();

-- Moderátor/admin může upravit i cizí profil (appka to reálně využije jen
-- pro zablokování/odblokování - viz trigger výše, který vše ostatní vrátí zpět).
do $$ begin
  create policy "Moderátor může upravit cizí profil"
  on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('moderator', 'admin')));
exception when duplicate_object then null; end $$;

-- Moderátor/admin může smazat kterékoliv video, ne jen svoje.
do $$ begin
  create policy "Moderátor může smazat kterékoliv video"
  on videos for delete
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('moderator', 'admin')));
exception when duplicate_object then null; end $$;

-- Moderátor/admin může smazat kterýkoliv příspěvek (post), ne jen svůj.
do $$ begin
  create policy "Moderátor může smazat kterýkoliv příspěvek"
  on posts for delete
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('moderator', 'admin')));
exception when duplicate_object then null; end $$;

-- Jak appce dát prvního moderátora/admina (spusť ručně, uprav email):
-- update profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'tvuj@email.cz');
