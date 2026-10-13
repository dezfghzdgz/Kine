-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- PŘÍSPĚVKY A ANKETY + HODINY ŽIVĚ (odznak) + OZNÁMENÍ O NOVÉM PŘÍSPĚVKU
--
-- 1) Příspěvky: až 4 fotky (image_urls), video z Kine v příspěvku (video_id),
--    konec ankety (poll_ends_at), připnutí na kanálu (pinned_at), "upraveno"
--    (edited_at) a jednou poslané oznámení odběratelům (notified_at).
-- 2) Majitel smí u svého příspěvku měnit jen text a připnutí - ne hlasy ani
--    nic jiného (práva po sloupcích + pravidlo jen pro majitele). Starší
--    pravidla pro úpravy (i "Přihlášený hlasuje v anketě") se zruší.
-- 3) Hlasování v anketě: hlas jde změnit, po konci ankety se nehlasuje.
-- 4) Majitel příspěvku smí smazat komentář u svého příspěvku (jako u videa).
-- 5) Oznámení druhu "new_post" (zvoneček u odběratelů).
-- 6) Odvysílaný čas kanálu (profiles.live_seconds) pro odznak "Hodiny živě".
--
-- Bez skriptu web funguje dál: příspěvek má jednu fotku, odkaz na video
-- jde do textu, anketa nemá konec, odznak Hodiny živě se počítá jen ze
-- zveřejněných záznamů. Skript jde spustit i víckrát.

-- 1) Nové sloupce příspěvků -----------------------------------------------
alter table posts add column if not exists image_urls text[];
alter table posts add column if not exists video_id uuid references videos(id) on delete set null;
alter table posts add column if not exists poll_ends_at timestamptz;
alter table posts add column if not exists pinned_at timestamptz;
alter table posts add column if not exists edited_at timestamptz;
alter table posts add column if not exists notified_at timestamptz;

-- Nejvýš 4 fotky a rozumná délka textu.
alter table posts drop constraint if exists posts_image_urls_max;
alter table posts add constraint posts_image_urls_max check (image_urls is null or array_length(image_urls, 1) <= 4);
alter table posts drop constraint if exists posts_content_length;
-- "not valid": starší dlouhé příspěvky zůstanou, hlídá se jen nové a upravené.
alter table posts add constraint posts_content_length check (content is null or char_length(content) <= 5000) not valid;

-- 2) Úpravy jen textu a připnutí, jen majitel --------------------------------
revoke update on posts from anon, authenticated;
grant update (content, pinned_at, edited_at) on posts to authenticated;

-- Jiná pravidla pro úpravy příspěvků pryč (staré "Přihlášený hlasuje v anketě" dovolovalo
-- přepsat cizí příspěvek komukoli přihlášenému) - hlasuje se funkcí vote_post_poll.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'posts' and cmd = 'UPDATE'
       and policyname <> 'Majitel upravuje text a připnutí svého příspěvku'
  loop
    execute format('drop policy %I on posts', pol.policyname);
  end loop;
end $$;

do $$ begin
  create policy "Majitel upravuje text a připnutí svého příspěvku" on posts for update
    using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;

-- 3) Hlasování: změna hlasu, konec ankety -------------------------------------
create or replace function vote_post_poll(p_post_id uuid, p_option int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ja uuid := auth.uid();
  moznosti jsonb;
  konec timestamptz;
  pocet int;
  vysledek jsonb := '[]'::jsonb;
  hlasu int;
  zablokovany boolean := false;
begin
  if ja is null then
    raise exception 'Musíš být přihlášený.' using errcode = 'insufficient_privilege';
  end if;

  begin
    select coalesce(p.is_banned, false) into zablokovany from profiles p where p.id = ja;
  exception when others then
    zablokovany := false;
  end;
  if coalesce(zablokovany, false) then
    raise exception 'Účet je zablokovaný.' using errcode = 'insufficient_privilege';
  end if;

  -- "for update": souběžné hlasy se seřadí a počty sedí.
  select poll_options, poll_ends_at into moznosti, konec
    from posts
   where id = p_post_id and type = 'poll'
   for update;

  if moznosti is null or jsonb_typeof(moznosti) <> 'array' then
    raise exception 'Anketa nenalezena.' using errcode = 'no_data_found';
  end if;
  if konec is not null and konec <= now() then
    raise exception 'Hlasování skončilo.' using errcode = 'invalid_parameter_value';
  end if;

  pocet := jsonb_array_length(moznosti);
  if p_option is null or p_option < 0 or p_option >= pocet then
    raise exception 'Taková možnost v anketě není.' using errcode = 'invalid_parameter_value';
  end if;

  -- Jeden hlas na člověka; nový hlas přepíše starý (změna názoru).
  insert into post_votes (post_id, user_id, option_index)
  values (p_post_id, ja, p_option)
  on conflict (post_id, user_id) do update set option_index = excluded.option_index
    where post_votes.option_index is distinct from excluded.option_index;

  for i in 0 .. pocet - 1 loop
    select count(*) into hlasu from post_votes where post_id = p_post_id and option_index = i;
    vysledek := vysledek || jsonb_build_array(
      (case when jsonb_typeof(moznosti -> i) = 'object' then moznosti -> i else jsonb_build_object('text', moznosti -> i) end)
      || jsonb_build_object('votes', hlasu)
    );
  end loop;

  update posts set poll_options = vysledek where id = p_post_id;
  return vysledek;
end;
$$;

revoke execute on function vote_post_poll(uuid, int) from public, anon;
grant execute on function vote_post_poll(uuid, int) to authenticated, service_role;

-- Změna hlasu potřebuje update vlastního řádku v post_votes (funkce běží jako vlastník,
-- tohle je jen pro jistotu, kdyby hlasovalo starší rozhraní napřímo).
do $$ begin
  create policy "Uživatel mění jen svůj hlas" on post_votes for update
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 4) Komentáře u příspěvku smí mazat i majitel příspěvku ------------------------
do $$ begin
  create policy "Majitel příspěvku maže komentáře pod ním" on comments for delete
    using (exists (select 1 from posts where posts.id = comments.post_id and posts.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- 5) Oznámení o novém příspěvku ----------------------------------------------
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'view_milestone', 'donation',
                  'subscription', 'new_video', 'new_post', 'comment_reply', 'moderation_warning', 'live', 'badge'));

-- 6) Odvysílaný čas (odznak Hodiny živě) - přičítá jen server --------------------
alter table profiles add column if not exists live_seconds bigint not null default 0;

create or replace function add_live_seconds(p_user uuid, p_seconds integer)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update profiles
     set live_seconds = coalesce(live_seconds, 0) + greatest(0, least(coalesce(p_seconds, 0), 86400))
   where id = p_user;
$$;

revoke execute on function add_live_seconds(uuid, integer) from public, anon, authenticated;
grant execute on function add_live_seconds(uuid, integer) to service_role;
