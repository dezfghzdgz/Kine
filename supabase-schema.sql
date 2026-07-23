-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

-- Profily uživatelů / kanálů
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default now()
);

-- Videa
create table videos (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  description text,
  cloudflare_video_id text not null, -- ID videa v Cloudflare Stream
  thumbnail_url text,
  duration_seconds int,
  status text default 'processing', -- processing | ready | failed
  views int default 0,
  created_at timestamp with time zone default now()
);

-- Lajky / disliky
create table video_reactions (
  video_id uuid references videos(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamp with time zone default now(),
  primary key (video_id, user_id)
);

-- Komentáře
create table comments (
  id uuid default gen_random_uuid() primary key,
  video_id uuid references videos(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamp with time zone default now()
);

-- Row Level Security - zapneme ochranu dat
alter table profiles enable row level security;
alter table videos enable row level security;
alter table video_reactions enable row level security;
alter table comments enable row level security;

-- Kdokoliv může číst profily a videa (je to veřejná platforma)
create policy "Profiles jsou veřejně viditelné" on profiles for select using (true);
create policy "Videa jsou veřejně viditelná" on videos for select using (true);
create policy "Reakce jsou veřejně viditelné" on video_reactions for select using (true);
create policy "Komentáře jsou veřejně viditelné" on comments for select using (true);

-- Upravovat může jen vlastník
create policy "Uživatel upravuje jen svůj profil" on profiles for update using (auth.uid() = id);
create policy "Uživatel vkládá jen svůj profil" on profiles for insert with check (auth.uid() = id);

create policy "Uživatel nahrává videa jen pod sebe" on videos for insert with check (auth.uid() = owner_id);
create policy "Uživatel upravuje jen svoje videa" on videos for update using (auth.uid() = owner_id);
create policy "Uživatel maže jen svoje videa" on videos for delete using (auth.uid() = owner_id);

create policy "Přihlášený uživatel může reagovat" on video_reactions for insert with check (auth.uid() = user_id);
create policy "Uživatel upravuje jen svoji reakci" on video_reactions for update using (auth.uid() = user_id);
create policy "Uživatel maže jen svoji reakci" on video_reactions for delete using (auth.uid() = user_id);

create policy "Přihlášený uživatel může komentovat" on comments for insert with check (auth.uid() = user_id);
create policy "Uživatel maže jen svůj komentář" on comments for delete using (auth.uid() = user_id);
