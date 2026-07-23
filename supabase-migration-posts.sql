-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table if not exists posts (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references profiles(id) on delete cascade not null,
  type text not null check (type in ('text', 'photo', 'poll')),
  content text,
  image_url text,
  poll_options jsonb,
  created_at timestamp with time zone default now()
);

alter table posts enable row level security;

do $$ begin
  create policy "Příspěvky jsou veřejně viditelné" on posts for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel vytváří jen svoje příspěvky" on posts for insert with check (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel maže jen svoje příspěvky" on posts for delete using (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;

create table if not exists post_votes (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  option_index int not null,
  primary key (post_id, user_id)
);

alter table post_votes enable row level security;

do $$ begin
  create policy "Hlasy jsou veřejně viditelné" on post_votes for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel hlasuje jen sám za sebe" on post_votes for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Komentáře teď mohou patřit buď videu, nebo příspěvku
alter table comments add column if not exists post_id uuid references posts(id) on delete cascade;
alter table comments alter column video_id drop not null;

-- Obrázek/GIF přiložený ke komentáři
alter table comments add column if not exists image_url text;

-- Úložiště pro obrázky u příspěvků a komentářů
insert into storage.buckets (id, name, public) values ('post-images', 'post-images', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('comment-images', 'comment-images', true) on conflict (id) do nothing;

do $$ begin
  create policy "Obrázky příspěvků jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'post-images');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává obrázek příspěvku jen do své složky" on storage.objects for insert
    with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Obrázky komentářů jsou veřejně viditelné" on storage.objects for select using (bucket_id = 'comment-images');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel nahrává obrázek komentáře jen do své složky" on storage.objects for insert
    with check (bucket_id = 'comment-images' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
