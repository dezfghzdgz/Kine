-- Sloupce potrebne pro pripojeni tvurce ke Stripe Connect, at appka
-- muze posilat penize primo na jeho vlastni ucet.
alter table profiles add column if not exists stripe_account_id text;
alter table profiles add column if not exists stripe_onboarding_complete boolean not null default false;
alter table profiles add column if not exists subscription_price_eur numeric;
alter table profiles add column if not exists subscription_stripe_price_id text;

-- Appka si tady drzi, kdo si u koho plati mesicni predplatne (na rozdil
-- od obycejneho "sledovani" v tabulce subscriptions - tohle je vylozene
-- o penezich).
create table if not exists channel_subscriptions (
  id uuid default gen_random_uuid() primary key,
  subscriber_id uuid references profiles(id) on delete cascade not null,
  creator_id uuid references profiles(id) on delete cascade not null,
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due')),
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (subscriber_id, creator_id)
);

alter table channel_subscriptions enable row level security;

do $$ begin
  create policy "Appka si vidi svoje vlastni predplatne" on channel_subscriptions for select
  using (auth.uid() = subscriber_id or auth.uid() = creator_id);
exception when duplicate_object then null; end $$;
-- Zadne vkladani/mazani z appky (anon klic) - tuhle tabulku upravuje
-- jen vlastni server (service role) pres webhook ze Stripe.
