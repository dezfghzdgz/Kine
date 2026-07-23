-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

-- Lajky/dislajky u příspěvků
create table if not exists post_reactions (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamp with time zone default now(),
  primary key (post_id, user_id)
);
alter table post_reactions enable row level security;
do $$ begin
  create policy "Lajky příspěvků jsou veřejně viditelné" on post_reactions for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel hodnotí jen sám za sebe" on post_reactions for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen svůj lajk" on post_reactions for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Veřejné / soukromé playlisty
alter table playlists add column if not exists visibility text default 'private' check (visibility in ('public', 'private'));
alter table playlists add column if not exists saved_from uuid references playlists(id) on delete set null;
