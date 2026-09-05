-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- PRAVIDLA PRO UŽIVATELSKÁ JMÉNA
--
-- Do teď se jméno nekontrolovalo vůbec. Formulář v prohlížeči sice něco
-- hlídal, ale anon klíč Supabase je veřejný - kdokoliv umí formulář obejít
-- a zapsat si do profilu, co chce. Proto pravidla patří sem, do databáze.
--
-- Co to zavádí:
--   * 3 až 20 znaků, jen základní latinka, číslice, tečka a podtržítko
--   * musí začínat i končit písmenem nebo číslicí
--   * dvě oddělovací znaménka nesmí být za sebou (jan..novak)
--   * jedinečnost bez ohledu na velikost písmen ("Kine" = "kine")
--   * rezervovaná jména (admin, support, kine, me, ...) si nikdo nevezme
--
-- Prázdné jméno tím pádem nikdo nový mít nemůže.
--
-- Schválně to NENÍ check constraint, ale spouštěč (trigger): check by se
-- při zavádění pustil na všechny existující řádky a komukoliv se starým
-- divným jménem by od té chvíle nešlo uložit ani změna popisku profilu.
-- Takhle se kontroluje jen jméno, které se opravdu mění.

-- ---------------------------------------------------------------------
-- 1. Výjimka
-- ---------------------------------------------------------------------
-- Zakladatelský účet má prázdné jméno a má si ho nechat. Výjimku nastavuje
-- jen tenhle sloupec - z prohlížeče si ji nikdo zapnout nemůže (viz krok 4).
--
-- >>> TADY JE ID ÚČTU, KTERÝ SI SMÍ NECHAT PRÁZDNÉ JMÉNO. <<<
-- Kdyby ses někdy stěhoval na jiný účet, přepiš ho.

alter table profiles add column if not exists username_exempt boolean not null default false;

update profiles
set username_exempt = true
where id = 'bf125a6c-f88c-47c4-9b9d-3ccc96ab313f';

comment on column profiles.username_exempt is
  'Účet smí mít jméno mimo pravidla (prázdné, kratší, rezervované). Nastavuje se jen ručně v databázi nebo přes service role.';

-- ---------------------------------------------------------------------
-- 2. Kontrola jména
-- ---------------------------------------------------------------------

create or replace function username_is_valid(name text)
returns boolean as $$
begin
  if name is null then
    return false;
  end if;

  if length(name) < 3 or length(name) > 20 then
    return false;
  end if;

  -- Písmena, číslice, tečka, podtržítko; na kraji vždycky písmeno nebo číslice.
  if name !~ '^[a-zA-Z0-9][a-zA-Z0-9._]*[a-zA-Z0-9]$' then
    return false;
  end if;

  -- Dvě oddělovací znaménka za sebou.
  if name ~ '[._]{2}' then
    return false;
  end if;

  -- Rezervovaná jména. Půlka kvůli vydávání se za appku nebo podporu,
  -- druhá kvůli adresám - /channel/me už v appce něco znamená.
  if lower(name) = any (array[
    'admin', 'administrator', 'root', 'system', 'sysadmin',
    'kine', 'kineapp', 'kineofficial', 'official', 'staff', 'team',
    'support', 'help', 'helpdesk', 'moderator', 'moderators', 'mod', 'mods',
    'security', 'billing', 'payments', 'legal', 'privacy', 'terms',
    'api', 'www', 'app', 'cdn', 'static', 'assets',
    'me', 'you', 'null', 'undefined', 'anonymous', 'deleted',
    'everyone', 'here', 'all'
  ]) then
    return false;
  end if;

  return true;
end;
$$ language plpgsql immutable;

-- ---------------------------------------------------------------------
-- 3. Spouštěč
-- ---------------------------------------------------------------------
-- Kontroluje se jen tehdy, když se jméno opravdu zakládá nebo mění.
-- Kdo má staré divné jméno, o účet nepřijde - jen si ho nemůže přenastavit
-- na jiné divné.

create or replace function enforce_username_rules()
returns trigger as $$
begin
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if coalesce(new.username_exempt, false) then
    return new;
  end if;

  if not username_is_valid(new.username) then
    raise exception 'Neplatné uživatelské jméno: %', coalesce(new.username, '(prázdné)')
      using errcode = 'check_violation',
            hint = '3 az 20 znaku, jen pismena bez diakritiky, cislice, tecka a podtrzitko. Na zacatku a na konci pismeno nebo cislice.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_username_rules on profiles;

create trigger trg_enforce_username_rules
before insert or update on profiles
for each row
execute function enforce_username_rules();

-- ---------------------------------------------------------------------
-- 4. Aby si výjimku nikdo nezapnul sám
-- ---------------------------------------------------------------------
-- Rozšíření spouštěče z supabase-migration-protect-admin-fields.sql.
-- Kdyby si ji uživatel mohl přepnout z prohlížeče, celá pravidla by byla
-- k ničemu - stačilo by si ji zapnout a zapsat si jméno, jaké chce.

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
-- 5. Jedinečnost bez ohledu na velikost písmen
-- ---------------------------------------------------------------------
-- Sloupec je unique, ale porovnává se přesně - "Kine" a "kine" jsou pro
-- databázi dvě různá jména a je to nejlacinější způsob, jak se vydávat za
-- někoho jiného.
--
-- Když už dvě taková jména v databázi jsou, index se založit nedá. Skript
-- proto nespadne, jen napíše, koho se to týká, ať to jde v klidu srovnat
-- a spustit tenhle blok znovu.

do $$
begin
  begin
    create unique index if not exists profiles_username_lower_key on profiles (lower(username));
  exception when unique_violation then
    raise notice 'Index se nepodarilo zalozit - dve jmena se lisi jen velikosti pismen. Najdes je timhle dotazem:';
    raise notice 'select lower(username), count(*) from profiles group by 1 having count(*) > 1;';
  end;
end $$;

-- ---------------------------------------------------------------------
-- Kontrola na závěr
-- ---------------------------------------------------------------------
-- Tohle musí projít (výjimka):
--   update profiles set username = '' where id = 'bf125a6c-f88c-47c4-9b9d-3ccc96ab313f';
-- Tohle musí skončit chybou:
--   update profiles set username = '' where id = '<jiny-ucet>';
--   update profiles set username = ' ' where id = '<jiny-ucet>';
--   update profiles set username = 'admin' where id = '<jiny-ucet>';
