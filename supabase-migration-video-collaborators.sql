-- Appka umožní k videu přidat "spolupracovníka" - druhého tvůrce, který
-- se u videa zobrazí vedle hlavního nahrávajícího, a video se mu zároveň
-- objeví i na jeho vlastním kanálu. Video pořád edituje/maže jen ten, kdo
-- ho reálně nahrál (owner_id u videos) - spolupracovník dostává "kredit",
-- ne technická práva k videu.
create table if not exists video_collaborators (
  video_id uuid references videos(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (video_id, profile_id)
);

alter table video_collaborators enable row level security;

create policy "Kdokoliv vidí spolupracovníky videa" on video_collaborators for select using (true);

create policy "Vlastník videa může přidat spolupracovníka" on video_collaborators for insert
  with check (exists (select 1 from videos where videos.id = video_id and videos.owner_id = auth.uid()));

create policy "Vlastník videa může spolupracovníka odebrat" on video_collaborators for delete
  using (exists (select 1 from videos where videos.id = video_id and videos.owner_id = auth.uid()));
