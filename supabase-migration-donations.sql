-- Appka si tady drží záznam jednotlivých darů (kdo, kolik, kdy) a
-- příznak u profilu, že uživatel appku podpořil (appka mu pak zobrazí
-- odznak "podporovatel").
create table if not exists donations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete set null,
  amount_eur numeric not null,
  stripe_session_id text,
  created_at timestamptz not null default now()
);

alter table donations enable row level security;
-- Žádný přímý přístup z appky (anon klíč) - k tabulce se dostane jen
-- appky vlastní server (service role) přes webhook z appky Stripe appky.

alter table profiles add column if not exists is_supporter boolean not null default false;

-- Pojistka: is_supporter appky jde měnit jen přes appky vlastní server
-- (webhook), ne přímo appky klienta appky - appky se to appky přidá
-- appky stejné appky ochrany appky co appka role/is_banned appky.
create or replace function prevent_client_supporter_change() returns trigger as $$
begin
  if new.is_supporter is distinct from old.is_supporter and auth.uid() is not null then
    new.is_supporter := old.is_supporter;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_client_supporter_change on profiles;
create trigger trg_prevent_client_supporter_change
  before update on profiles
  for each row execute function prevent_client_supporter_change();
