-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- VYHLEDÁVÁNÍ, KTERÉ NAJDE
--
-- Dosud: hledání = "název obsahuje přesně to, co jsi napsal". Bez háčků
-- nenajde s háčky, překlep nenajde nic, dvě slova musí být v tomhle pořadí
-- za sebou. Tak hledá web z roku 2005; lidi čekají YouTube.
--
-- Teď, přímo v databázi, bez cizí služby:
--   - fulltext (víc slov v libovolném pořadí, řazení podle shody),
--   - bez ohledu na háčky a čárky ("tutorial" najde "Tutoriál"),
--   - překlepy přes podobnost trigramů ("tutorail" najde "tutoriál"),
--   - hledá se v názvu, popisu i hashtagách,
--   - tvůrci podle jména i zobrazovaného jména, stejně tolerantně.
--
-- Appka volá funkce search_videos / search_creators. Když migrace ještě
-- neproběhla, spadne zpátky na staré hledání - nic se nerozbije, jen
-- to bude hledat postaru.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- unaccent je "stable", ne "immutable", a v indexu ani generovaném sloupci
-- se proto použít nedá. Tenhle obal s pevně daným slovníkem už immutable
-- být smí - výsledek pro stejný text je vždy stejný.
create or replace function kine_unaccent(text)
returns text
language sql immutable parallel safe strict
set search_path = public, extensions
as $$
  select lower(unaccent('unaccent', $1));
$$;

-- array_to_string je v Postgresu "stable", a generovaný sloupec chce jen
-- "immutable" výrazy. Tenhle spoj hashtagů mezerou immutable je.
create or replace function kine_join_words(text[])
returns text
language sql immutable parallel safe
as $$
  select coalesce((select string_agg(w, ' ') from unnest($1) as w), '');
$$;

-- Sloupec s předžvýkaným textem pro fulltext: název + popis + hashtagy.
-- Generovaný, takže se sám udržuje při každé změně videa.
do $$
begin
  alter table videos add column search_tsv tsvector
    generated always as (
      to_tsvector(
        'simple'::regconfig,
        kine_unaccent(
          coalesce(title, '') || ' ' ||
          coalesce(description, '') || ' ' ||
          kine_join_words(coalesce(hashtags, '{}'::text[]))
        )
      )
    ) stored;
exception when duplicate_column then
  null;
end $$;

create index if not exists idx_videos_search_tsv on videos using gin (search_tsv);
-- Trigramy nad názvem bez háčků - pro překlepy a části slov.
create index if not exists idx_videos_title_trgm on videos using gin (kine_unaccent(title) gin_trgm_ops);
create index if not exists idx_profiles_username_trgm on profiles using gin (kine_unaccent(username) gin_trgm_ops);
create index if not exists idx_profiles_display_name_trgm on profiles using gin (kine_unaccent(display_name) gin_trgm_ops);

-- Hledání videí. Vrací jen hotová a veřejná, seřazená podle shody:
--   fulltextová shoda váží nejvíc, podobnost s kusem názvu (překlepy) doplňuje,
--   při shodě rozhodne počet zhlédnutí.
create or replace function search_videos(q text, max_rows int default 48)
returns table (
  id uuid,
  title text,
  thumbnail_url text,
  views bigint,
  owner_id uuid,
  rank real
)
language sql stable
set search_path = public, extensions
as $$
  with needle as (
    select
      kine_unaccent(trim(q)) as raw,
      websearch_to_tsquery('simple'::regconfig, kine_unaccent(trim(q))) as tsq
  )
  select
    v.id,
    v.title,
    v.thumbnail_url,
    v.views::bigint,
    v.owner_id,
    (
      ts_rank(v.search_tsv, n.tsq) * 4
      + word_similarity(n.raw, kine_unaccent(v.title)) * 2
      + case when kine_unaccent(v.title) like '%' || n.raw || '%' then 1 else 0 end
    )::real as rank
  from videos v
  cross join needle n
  where v.status = 'ready'
    and v.visibility = 'public'
    and length(n.raw) > 0
    and (
      v.search_tsv @@ n.tsq
      or kine_unaccent(v.title) like '%' || n.raw || '%'
      -- word_similarity: podobnost hledaného slova s nejbližším kusem názvu,
      -- ne s celým názvem - dlouhý název by jinak překlep nikdy "nedohnal".
      or word_similarity(n.raw, kine_unaccent(v.title)) > 0.4
    )
  order by rank desc, v.views desc, v.created_at desc
  limit greatest(1, least(coalesce(max_rows, 48), 200));
$$;

-- Hledání tvůrců podle jména i zobrazovaného jména, stejně tolerantně.
create or replace function search_creators(q text, max_rows int default 12)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  rank real
)
language sql stable
set search_path = public, extensions
as $$
  with needle as (select kine_unaccent(trim(q)) as raw)
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    greatest(
      similarity(kine_unaccent(coalesce(p.username, '')), n.raw),
      similarity(kine_unaccent(coalesce(p.display_name, '')), n.raw),
      case when kine_unaccent(coalesce(p.username, '')) like '%' || n.raw || '%'
             or kine_unaccent(coalesce(p.display_name, '')) like '%' || n.raw || '%' then 0.9 else 0 end
    )::real as rank
  from profiles p
  cross join needle n
  where length(n.raw) > 0
    and p.username is not null
    and (
      kine_unaccent(p.username) like '%' || n.raw || '%'
      or kine_unaccent(coalesce(p.display_name, '')) like '%' || n.raw || '%'
      or similarity(kine_unaccent(p.username), n.raw) > 0.35
      or similarity(kine_unaccent(coalesce(p.display_name, '')), n.raw) > 0.35
    )
  order by rank desc, p.username
  limit greatest(1, least(coalesce(max_rows, 12), 100));
$$;

-- Funkce smí volat kdokoliv (vrací jen veřejná videa a veřejné sloupce
-- profilů), appka je ale volá ze serveru.
grant execute on function search_videos(text, int) to anon, authenticated;
grant execute on function search_creators(text, int) to anon, authenticated;

notify pgrst, 'reload schema';
