-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- KRITICKÁ BEZPEČNOSTNÍ OPRAVA:
-- Dosavadní pravidlo "uživatel upravuje jen svůj profil" hlídalo jen to,
-- ČÍ profil se upravuje - ne KTERÉ konkrétní údaje v něm. Technicky zdatný
-- člověk by si tak teoreticky mohl přes prohlížeč sám nastavit is_admin
-- nebo verification_tier na svém vlastním účtu.
--
-- Tenhle spouštěč (trigger) běží přímo v databázi před každou úpravou
-- profilu a tyhle dva citlivé údaje ochrání - jít změnit můžou jen tehdy,
-- když požadavek přijde z appky přes tzv. "service role" (to znamená přes
-- naše /api/admin/... endpointy, ne přímo od uživatele v prohlížeči).

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
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_admin_fields on profiles;

create trigger trg_protect_admin_fields
before update on profiles
for each row
execute function protect_admin_fields();
