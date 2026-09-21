-- Spusť v Supabase dashboardu -> SQL Editor -> New Query. Klidně víckrát
-- (i když už jednou proběhla starší verze s hodnotami free/plus).
--
-- PŘEDPLATNÉ KINE - tři placené varianty (lib/plus.ts):
--
--   kine   Kine Plus         web: odznak PLUS u jména, 3x vyšší denní limit nahrávání
--   clips  Klipy Plus        appka do PC: klipy se po hře nahrávají samy, klipy až 5 minut
--   all    Kine Plus + Klipy obojí
--   plus   starší hodnota z první verze = all (přepíše se níž)
--   free   základ: klipování v appce bez omezení, klipy do 60 s, nahrání ručně
--
-- plan            'free' | 'kine' | 'clips' | 'all'
-- plan_until      do kdy předplatné platí (null = bez konce, třeba ručně od admina)
-- plan_stripe_*   vazba na předplatné u Stripe (nastavuje webhook)
-- plan_note       poznámka admina (proč dostal předplatné ručně)
--
-- Sloupce smí měnit jen server (service role): webhook od Stripe a
-- /api/admin/plus. Z prohlížeče je změna tiše vrácena zpátky - stejný
-- princip jako u is_admin (supabase-migration-protect-admin-fields.sql).

alter table profiles add column if not exists plan text not null default 'free';
alter table profiles add column if not exists plan_until timestamptz;
alter table profiles add column if not exists plan_stripe_subscription_id text;
alter table profiles add column if not exists plan_stripe_customer_id text;
alter table profiles add column if not exists plan_note text;

-- Starší kontrola dovolovala jen free/plus - pryč s ní dřív, než se
-- "plus" přepíše na "all" (jinak by přepis spadl na té staré kontrole).
-- Stejně tak ochranný spouštěč z první verze: ten by přepis tiše vrátil.
-- Oba se níž zase založí.
alter table profiles drop constraint if exists profiles_plan_check;
drop trigger if exists trg_protect_plan_fields on profiles;
update profiles set plan = 'all' where plan = 'plus';
alter table profiles add constraint profiles_plan_check check (plan in ('free', 'kine', 'clips', 'all'));

comment on column profiles.plan is 'Předplatné: free | kine (Kine Plus) | clips (Klipy Plus) | all (obojí). Mění jen server (Stripe webhook, admin).';
comment on column profiles.plan_until is 'Do kdy předplatné platí; null = bez konce.';

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

-- Kdo má předplatné, je veřejná informace (odznak u jména). Když jsou na
-- profiles sloupcová práva (supabase-migration-privacy-fixes.sql), nový
-- sloupec by z prohlížeče nešel přečíst - proto se povolí výslovně.
-- Stripe vazby a poznámka zůstávají jen serveru.
grant select (plan, plan_until) on profiles to anon, authenticated;

-- Má jakékoliv placené předplatné právě teď?
create or replace function has_plus(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.plan <> 'free' and (p.plan_until is null or p.plan_until > now())
       from profiles p where p.id = profile_id),
    false
  );
$$;

-- Kine Plus (web): kine nebo all.
create or replace function has_kine_plus(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.plan in ('kine', 'all') and (p.plan_until is null or p.plan_until > now())
       from profiles p where p.id = profile_id),
    false
  );
$$;

-- Klipy Plus (appka): clips nebo all.
create or replace function has_clips_plus(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.plan in ('clips', 'all') and (p.plan_until is null or p.plan_until > now())
       from profiles p where p.id = profile_id),
    false
  );
$$;

revoke execute on function has_plus(uuid) from public;
revoke execute on function has_kine_plus(uuid) from public;
revoke execute on function has_clips_plus(uuid) from public;
grant execute on function has_plus(uuid) to anon, authenticated, service_role;
grant execute on function has_kine_plus(uuid) to anon, authenticated, service_role;
grant execute on function has_clips_plus(uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
