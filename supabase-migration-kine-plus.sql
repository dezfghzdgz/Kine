-- Spusť v Supabase dashboardu -> SQL Editor -> New Query. Klidně víckrát.
--
-- KINE PLUS - placená verze.
--
-- Zatím jedna věc, kterou platí: appka Kine do PC smí nahrávat klipy na
-- Kine automaticky (v základní verzi hráč klipuje zdarma bez omezení a
-- klipy nahrává ručně, se stejnými pravidly jako každé video). K tomu
-- delší klipy v appce (až 5 minut místo 60 s) a odznak PLUS u jména.
--
-- plan            'free' | 'plus'
-- plan_until      do kdy Plus platí (null = bez konce, třeba ručně od admina)
-- plan_stripe_*   vazba na předplatné u Stripe (nastavuje webhook)
-- plan_note       poznámka admina (proč dostal Plus ručně)
--
-- Sloupce smí měnit jen server (service role): webhook od Stripe a
-- /api/admin/plus. Z prohlížeče je změna tiše vrácena zpátky - stejný
-- princip jako u is_admin (supabase-migration-protect-admin-fields.sql).

alter table profiles add column if not exists plan text not null default 'free';
alter table profiles drop constraint if exists profiles_plan_check;
alter table profiles add constraint profiles_plan_check check (plan in ('free', 'plus'));
alter table profiles add column if not exists plan_until timestamptz;
alter table profiles add column if not exists plan_stripe_subscription_id text;
alter table profiles add column if not exists plan_stripe_customer_id text;
alter table profiles add column if not exists plan_note text;

comment on column profiles.plan is 'Kine Plus: free | plus. Mění jen server (Stripe webhook, admin).';
comment on column profiles.plan_until is 'Do kdy Plus platí; null = bez konce.';

create or replace function protect_plan_fields()
returns trigger as $$
begin
  if auth.role() <> 'service_role' then
    new.plan := old.plan;
    new.plan_until := old.plan_until;
    new.plan_stripe_subscription_id := old.plan_stripe_subscription_id;
    new.plan_stripe_customer_id := old.plan_stripe_customer_id;
    new.plan_note := old.plan_note;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_plan_fields on profiles;
create trigger trg_protect_plan_fields
before update on profiles
for each row
execute function protect_plan_fields();

-- Kdo má Plus, je veřejná informace (odznak u jména). Když jsou na
-- profiles sloupcová práva (supabase-migration-privacy-fixes.sql), nový
-- sloupec by z prohlížeče nešel přečíst - proto se povolí výslovně.
-- Stripe vazby a poznámka zůstávají jen serveru.
grant select (plan, plan_until) on profiles to anon, authenticated;

-- Má Plus právě teď? Jedno místo pro pravidlo "plus a neprošlá platnost".
create or replace function has_plus(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.plan = 'plus' and (p.plan_until is null or p.plan_until > now())
       from profiles p where p.id = profile_id),
    false
  );
$$;

revoke execute on function has_plus(uuid) from public;
grant execute on function has_plus(uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
