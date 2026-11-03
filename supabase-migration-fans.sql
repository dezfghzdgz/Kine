-- Spusť CELÉ v Supabase dashboardu -> SQL Editor -> New Query -> Run.
--
-- ZEĎ FANOUŠKŮ (playkine.com/fans) + odznak Zakladatel - kolo kine-0143
--
-- Dá se pustit i opakovaně (nic se nezdvojí ani nesmaže).
--
--   fan_wall           přezdívky z Instagramu na zdi (den kampaně, případně
--                      propojený účet na Kine). Čte a zapisuje jen server
--                      (Admin -> Zeď fanoušků a stránka /fans) - z prohlížeče
--                      se k tabulce nikdo nedostane.
--   fan_wall_settings  účet Kine na Instagramu (tlačítko "Sledovat" na zdi).
--   odznak Zakladatel  speciální odznak pro propojené fanoušky (founder).


create table if not exists fan_wall (
  id bigserial primary key,
  platform text not null default 'instagram',
  handle text not null,
  day integer not null default 1,
  profile_id uuid references profiles(id) on delete set null,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Pravidla zvlášť (ať jdou doplnit i do tabulky z dřívějška).
alter table fan_wall drop constraint if exists fan_wall_platform_check;
alter table fan_wall add constraint fan_wall_platform_check check (platform in ('instagram', 'tiktok'));
alter table fan_wall drop constraint if exists fan_wall_handle_check;
alter table fan_wall add constraint fan_wall_handle_check check (handle ~ '^[a-z0-9._]{1,30}$');
alter table fan_wall drop constraint if exists fan_wall_day_check;
alter table fan_wall add constraint fan_wall_day_check check (day between 1 and 100000);

-- Jedna přezdívka jen jednou (server přidává "když už tam není").
create unique index if not exists fan_wall_platform_handle_key on fan_wall (platform, handle);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fan_wall_platform_handle_unique') then
    alter table fan_wall add constraint fan_wall_platform_handle_unique unique using index fan_wall_platform_handle_key;
  end if;
end $$;
create index if not exists fan_wall_created_idx on fan_wall (created_at desc, id desc);
create index if not exists fan_wall_profile_idx on fan_wall (profile_id) where profile_id is not null;

alter table fan_wall enable row level security;
revoke all on fan_wall from anon, authenticated;
grant all on fan_wall to service_role;
grant usage, select on sequence fan_wall_id_seq to service_role;


create table if not exists fan_wall_settings (
  id integer primary key default 1,
  instagram text,
  updated_at timestamptz not null default now()
);
alter table fan_wall_settings drop constraint if exists fan_wall_settings_single;
alter table fan_wall_settings add constraint fan_wall_settings_single check (id = 1);
alter table fan_wall_settings drop constraint if exists fan_wall_settings_instagram_check;
alter table fan_wall_settings add constraint fan_wall_settings_instagram_check check (instagram is null or instagram ~ '^[a-z0-9._]{1,30}$');
alter table fan_wall_settings enable row level security;
revoke all on fan_wall_settings from anon, authenticated;
grant all on fan_wall_settings to service_role;


-- Odznak Zakladatel: speciální odznaky hlídá seznam povolených - přidá se founder.
do $$
begin
  if to_regclass('public.profile_special_badges') is not null then
    alter table profile_special_badges drop constraint if exists profile_special_badges_badge_check;
    alter table profile_special_badges add constraint profile_special_badges_badge_check
      check (badge in ('owner', 'dev', 'team', 'moderator', 'betaTester', 'founder', 'partner', 'bugHunter'));
  end if;
end $$;


-- Ať Supabase nové tabulky hned uvidí.
notify pgrst, 'reload schema';

-- Kontrola (true = hotovo).
select
  to_regclass('public.fan_wall') is not null as zed_fanousku,
  to_regclass('public.fan_wall_settings') is not null as nastaveni,
  coalesce((select pg_get_constraintdef(oid) like '%founder%' from pg_constraint where conname = 'profile_special_badges_badge_check'), false) as odznak_zakladatel;
