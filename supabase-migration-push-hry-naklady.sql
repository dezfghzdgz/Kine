-- =====================================================================
-- Kine 0134: push oznámení, stránky her, hlídač nákladů
--
-- Spusť CELÉ v Supabase -> SQL Editor. Jde pouštět opakovaně (nic nemaže).
-- Na konci tabulka: push / hry / naklady = true.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) Push oznámení (telefon / počítač, i když Kine není otevřené)
-- ---------------------------------------------------------------------

-- Zařízení, která chtějí oznámení (adresa od prohlížeče + klíče pro šifrování).
-- Zapisuje jen server (/api/push/subscribe) - ten ověří, že adresa míří
-- na push službu prohlížeče (Google, Mozilla, Apple, Microsoft), ne jinam.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 800),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  lang text not null default 'en' check (lang in ('cs', 'sk', 'en', 'de', 'es', 'fr', 'pl', 'uk')),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  failures int not null default 0
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
revoke insert, update on push_subscriptions from anon, authenticated;
grant select, delete on push_subscriptions to authenticated;
do $$ begin
  create policy "Push: vlastní zařízení" on push_subscriptions for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Push: smazat vlastní zařízení" on push_subscriptions for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Co chce dostávat (bez řádku = všechno zapnuté).
create table if not exists push_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  live boolean not null default true,
  uploads boolean not null default true,
  replies boolean not null default true,
  earnings boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table push_settings enable row level security;
grant select, insert, update on push_settings to authenticated;
do $$ begin
  create policy "Push: vlastní nastavení" on push_settings for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Každé oznámení se na zařízení pošle nejvýš jednou (kdo první zapíše čas, ten posílá).
-- Prohlížeč tenhle sloupec měnit nemůže (u oznámení smí jen "přečteno").
do $mig$ begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table notifications add column if not exists pushed_at timestamptz';
  else
    raise notice 'A) chybí tabulka notifications - push se zapne, až bude.';
  end if;
end $mig$;

-- ---------------------------------------------------------------------
-- B) Stránky her
-- ---------------------------------------------------------------------

-- Hra u živého přenosu (vybere se ve Studiu; videa mají hru v hashtagu).
do $mig$ begin
  if to_regclass('public.live_streams') is not null then
    execute 'alter table live_streams add column if not exists game text';
    execute 'alter table live_streams drop constraint if exists live_streams_game_format';
    execute $c$alter table live_streams add constraint live_streams_game_format check (game is null or game ~ '^[a-z0-9-]{1,40}$')$c$;
  else
    raise notice 'B) chybí tabulka live_streams - hra u přenosu přeskočena.';
  end if;
end $mig$;

-- Sledované hry (doporučování na hlavní stránce, "Tvoje hry").
create table if not exists game_follows (
  user_id uuid not null references profiles(id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, game)
);
create index if not exists game_follows_game_idx on game_follows (game);
alter table game_follows enable row level security;
grant select, insert, delete on game_follows to authenticated;
do $$ begin
  create policy "Hry: vlastní sledované" on game_follows for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Hry: sledovat" on game_follows for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Hry: přestat sledovat" on game_follows for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Strop: nejvýš 100 sledovaných her na účet (a tempo hlídá kine_limit_rate, když je).
create or replace function game_follows_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if (select count(*) from game_follows where user_id = new.user_id) >= 100 then
    raise exception 'Sleduješ už 100 her.' using errcode = 'check_violation';
  end if;
  return new;
end
$f$;
drop trigger if exists game_follows_cap on game_follows;
create trigger game_follows_cap before insert on game_follows for each row execute function game_follows_cap();
do $mig$ begin
  if to_regproc('public.kine_limit_rate') is not null then
    execute 'drop trigger if exists kine_limit_game_follows on game_follows';
    execute 'create trigger kine_limit_game_follows before insert on game_follows for each row execute function kine_limit_rate(''user_id'', ''30'', ''300'')';
  end if;
end $mig$;

-- Kolik lidí hru sleduje (jen číslo, bez jmen).
create or replace function game_follower_count(p_game text)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $f$
  select count(*)::int from game_follows where game = p_game;
$f$;
grant execute on function game_follower_count(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- C) Hlídač nákladů (Admin -> Náklady): velikost databáze a úložiště
-- ---------------------------------------------------------------------
create or replace function kine_admin_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
declare
  out jsonb := jsonb_build_object('db_bytes', pg_database_size(current_database()));
begin
  begin
    out := out || jsonb_build_object('storage', coalesce((
      select jsonb_object_agg(bucket_id, bytes)
        from (select bucket_id, sum(coalesce((metadata->>'size')::bigint, 0)) as bytes
                from storage.objects group by bucket_id) s
    ), '{}'::jsonb));
  exception when others then
    out := out || jsonb_build_object('storage', null);
  end;
  out := out || jsonb_build_object('tables', coalesce((
    select jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.bytes) order by t.bytes desc)
      from (select c.relname, pg_total_relation_size(c.oid) as bytes
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r'
             order by pg_total_relation_size(c.oid) desc
             limit 8) t
  ), '[]'::jsonb));
  return out;
end
$f$;
revoke execute on function kine_admin_usage() from public, anon, authenticated;
grant execute on function kine_admin_usage() to service_role;

notify pgrst, 'reload schema';

-- Kontrola (true = hotovo).
select
  to_regclass('public.push_subscriptions') is not null as push,
  to_regclass('public.game_follows') is not null as hry,
  to_regprocedure('public.kine_admin_usage()') is not null as naklady;
