-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table if not exists reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references profiles(id) on delete set null,
  video_id uuid references videos(id) on delete cascade,
  comment_id uuid references comments(id) on delete cascade,
  reason text not null,
  details text,
  status text default 'pending',
  created_at timestamp with time zone default now()
);

alter table reports enable row level security;

do $$ begin
  create policy "Uživatel nahlašuje jen sám za sebe" on reports for insert with check (auth.uid() = reporter_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Uživatel vidí jen svoje nahlášení" on reports for select using (auth.uid() = reporter_id);
exception when duplicate_object then null; end $$;
