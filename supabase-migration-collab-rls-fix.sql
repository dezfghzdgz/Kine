-- appka objevil skutečnou příčinu toho přetrvávajícího problému: appka
-- databáze má bezpečnostní pravidlo (existující v appky projektu, ale
-- nikde v naší dosavadní konverzaci nezmíněné appka nekontrolované), které
-- řídí, kdo smí video vůbec appka databáze přečíst - podle "public" /
-- vlastník / "subscribers", ale BEZ VÝJIMKY pro spolutvůrce appky videa
-- appky "private" (dokud nepotvrdí spolupráci).
--
-- Tohle appky pravidlo appku spolutvůrci appka databázi skutečně
-- BLOKOVALO appky vidět video vůbec - žádná oprava appky appky nemohla
-- pomoct, protože appka nikdy nedostala žádná data appka appce zpátky.

drop policy if exists "Videa jsou viditelná podle nastavení soukromí" on videos;

create policy "Videa jsou viditelná podle nastavení soukromí" on videos for select
using (
  visibility = 'public'
  or owner_id = auth.uid()
  or (
    visibility = 'subscribers'
    and exists (
      select 1 from subscriptions
      where subscriptions.channel_id = videos.owner_id
      and subscriptions.subscriber_id = auth.uid()
    )
  )
  or exists (
    select 1 from video_collaborators
    where video_collaborators.video_id = videos.id
    and video_collaborators.profile_id = auth.uid()
  )
);

-- appky moderátorské nástroje appky: appka appka appky vidět appky
-- nahlášení (appky teď jen appky, appky appky appky appky sami),
-- appky appka vypnout komentáře pod appky appky appky komentáře.
do $$ begin
  create policy "Moderátor vidí všechna nahlášení" on reports for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('moderator', 'admin')));
exception when duplicate_object then null; end $$;

alter table videos add column if not exists comments_disabled boolean not null default false;
alter table profiles add column if not exists disable_shorts boolean not null default false;

do $$ begin
  create policy "Moderátor může upravit cizí video (jen na vypnutí komentářů)" on videos for update
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('moderator', 'admin')));
exception when duplicate_object then null; end $$;

create or replace function prevent_moderator_video_field_change() returns trigger as $$
begin
  if auth.uid() is not null and auth.uid() <> old.owner_id then
    new.title := old.title;
    new.description := old.description;
    new.visibility := old.visibility;
    new.thumbnail_url := old.thumbnail_url;
    new.category := old.category;
    new.language := old.language;
    new.hashtags := old.hashtags;
    new.made_for_kids := old.made_for_kids;
    new.has_paid_promotion := old.has_paid_promotion;
    new.pending_collab_visibility := old.pending_collab_visibility;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_prevent_moderator_video_field_change on videos;
create trigger trg_prevent_moderator_video_field_change
  before update on videos
  for each row execute function prevent_moderator_video_field_change();

do $$ begin
  create policy "Moderátor může smazat kterýkoliv komentář" on comments for delete
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role in ('moderator', 'admin')));
exception when duplicate_object then null; end $$;
