-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- Tři věci z jednoho kola:
--   1) zařízení u zhlédnutí (telefon / tablet / počítač / TV)
--   2) tabulka pro chyby hlášené z prohlížeče
--   3) filtr nadávek v uživatelských jménech (stejný jako v prohlížeči)


-- ===========================================================================
-- 1) NA ČEM SE KINE SLEDUJE
-- ===========================================================================
-- Nevěděli jsme, jestli se Kine používá spíš na mobilu nebo na počítači.
-- Odteď si appka ke každému zhlédnutí poznamená třídu zařízení. Jen jednu
-- ze čtyř hodnot, nic víc - žádný otisk prohlížeče.

alter table views_log add column if not exists device text;

do $$
begin
  alter table views_log add constraint views_log_device_check
    check (device is null or device in ('phone', 'tablet', 'desktop', 'tv')) not valid;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_views_log_video_device on views_log (video_id, device);

-- Rychlý přehled (za posledních 30 dní):
--   select coalesce(device, 'neznámé') as zarizeni, count(*)
--   from views_log
--   where viewed_at > now() - interval '30 days'
--   group by 1 order by 2 desc;


-- ===========================================================================
-- 2) CHYBY Z PROHLÍŽEČE
-- ===========================================================================
-- Do teď se každá chyba v appce našla ručně - někdo si všiml, že něco
-- nefunguje. Odteď se chyby z prohlížeče posílají na /api/client-errors
-- a ukládají sem; přehled je na /admin/errors.
--
-- Zabezpečení: tabulka má zapnuté RLS a ŽÁDNÁ pravidla, takže z prohlížeče
-- ji nikdo nepřečte ani do ní nezapíše. Zapisuje jen server (service role)
-- a čte jen server po ověření is_admin.

create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  message text not null,
  stack text,
  url text,
  user_agent text,
  device text,
  user_id uuid references profiles(id) on delete set null,
  fingerprint text not null
);

alter table client_errors enable row level security;

create index if not exists idx_client_errors_created on client_errors (created_at desc);
create index if not exists idx_client_errors_fingerprint on client_errors (fingerprint, created_at desc);

comment on table client_errors is
  'Chyby JavaScriptu z prohlížečů návštěvníků. Zapisuje jen server, čte jen admin. Starší než 30 dní se mažou.';

-- Úklid - spouštěj občas ručně (nebo si na to nastav pg_cron, pokud ho máš):
--   delete from client_errors where created_at < now() - interval '30 days';


-- ===========================================================================
-- 3) NADÁVKY VE JMÉNECH
-- ===========================================================================
-- Ve výpisu účtů se objevilo jméno z rasistické nadávky. Kontrola je
-- v prohlížeči (lib/username.ts), ale ta jde obejít - anon klíč Supabase
-- je veřejný. Proto to samé pravidlo tady, v databázi.
--
-- POZOR: seznamy musí být stejné jako v lib/username.ts. Když měníš jeden,
-- změň i druhý. Test tests/username.test.mjs a kontrola níž hlídají, že
-- obě strany odpovídají stejně.

-- Kusy jména: souvislá písmena nebo souvislé číslice (tečka a podtržítko
-- rozdělují).
create or replace function username_words(s text)
returns text[] as $$
  select coalesce(array_agg(m[1]), '{}'::text[])
  from regexp_matches(coalesce(s, ''), '([a-z]+|[0-9]+)', 'g') as m;
$$ language sql immutable;

create or replace function username_contains_slur(name text)
returns boolean as $$
declare
  lower_name text := lower(coalesce(name, ''));
  joined text;
  bad text;
  w text;
  -- 0→o 1→i 3→e 4→a 5→s 7→t 8→b @→a $→s !→i
  leet_from constant text := '0134578@$!';
  leet_to   constant text := 'oieastbasi';
  -- Nesmí být ani uvnitř jiného slova.
  anywhere constant text[] := array[
    'nigger', 'nigga', 'niggr', 'faggot', 'fagot', 'wetback', 'raghead', 'towelhead',
    'tranny', 'hitler', 'heilhitler', 'buzerant', 'buzna', 'holohoax'
  ];
  -- Jen jako celé slovo (schovávají se v běžných slovech: spicy, raccoon,
  -- montenegro).
  as_word constant text[] := array[
    'negr', 'negri', 'nigr', 'spic', 'chink', 'coon', 'gook', 'dyke', 'cunt', 'retard',
    'nazi', 'rape', 'rapist', 'cigos', 'cigosi', 'fag', 'fags', '1488'
  ];
begin
  joined := regexp_replace(lower_name, '[._]', '', 'g');

  foreach bad in array anywhere loop
    if position(bad in joined) > 0
       or position(bad in translate(joined, leet_from, leet_to)) > 0 then
      return true;
    end if;
  end loop;

  foreach w in array username_words(lower_name) || username_words(translate(lower_name, leet_from, leet_to)) loop
    if w = any (as_word) or translate(w, leet_from, leet_to) = any (as_word) then
      return true;
    end if;
  end loop;

  return false;
end;
$$ language plpgsql immutable;

-- Pravidla pro jméno - stejná jako v supabase-migration-username-rules.sql,
-- navíc s kontrolou nadávek na konci.
create or replace function username_is_valid(name text)
returns boolean as $$
begin
  if name is null then
    return false;
  end if;
  if length(name) < 3 or length(name) > 20 then
    return false;
  end if;
  if name !~ '^[a-zA-Z0-9][a-zA-Z0-9._]*[a-zA-Z0-9]$' then
    return false;
  end if;
  if name ~ '[._]{2}' then
    return false;
  end if;
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
  if username_contains_slur(name) then
    return false;
  end if;
  return true;
end;
$$ language plpgsql immutable;

-- Kontrola, že databáze odpovídá stejně jako prohlížeč (stejné případy
-- jsou v tests/username.test.mjs). Když něco nesedí, vypíše to.
do $$
declare
  blokovana text[] := array[
    'nigger', 'NIGGER', 'n1gger', 'n1gg3r', 'nigga_king', 'xnigga', 'faggot.lol',
    'hitler1945', 'adolf_hitler', 'heilhitler', 'buzerant', 'negr', 'negr_123', 'n3gr',
    'spic', 'chink', 'coon', 'dyke', 'cunt', 'retard', 'nazi', 'nazi_boy', 'rape', 'rapist', '1488'
  ];
  povolena text[] := array[
    'montenegro', 'spicy_food', 'raccoon_fan', 'tycoon', 'scunthorpe', 'grape', 'drapery',
    'chinkiang', 'vandyke', 'retardant', 'coonhound', 'nazim', 'therapist', 'danielccerven58',
    'psicak', 'kine_fan', 'honza.novak', 'x_ae_a12', 'negrini', 'cigoska_lucie', 'kike_lopez'
  ];
  j text;
  chyb int := 0;
begin
  foreach j in array blokovana loop
    if not username_contains_slur(j) then
      raise notice 'CHYBA: melo byt blokovane: %', j; chyb := chyb + 1;
    end if;
  end loop;
  foreach j in array povolena loop
    if username_contains_slur(j) then
      raise notice 'CHYBA: nemelo byt blokovane: %', j; chyb := chyb + 1;
    end if;
  end loop;
  if chyb = 0 then
    raise notice 'Filtr jmen: databaze odpovida stejne jako prohlizec (% + % pripadu).', array_length(blokovana, 1), array_length(povolena, 1);
  end if;
end $$;

-- Kdo už takové jméno má (jen výpis, nic nemění):
--   select id, username from profiles
--   where username is not null and username_contains_slur(username);
--
-- Přejmenování takového účtu (doplň id z výpisu):
--   update profiles set username = 'user_' || left(id::text, 8) where id = 'SEM-ID';
