-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

alter table profiles add column if not exists verification_tier text default 'none' check (verification_tier in ('none', 'basic', 'silver', 'blue'));
alter table profiles add column if not exists is_admin boolean default false;

create table if not exists verification_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  subscriber_count_at_request int,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamp with time zone default now(),
  reviewed_at timestamp with time zone
);

alter table verification_requests enable row level security;

do $$ begin
  create policy "Uživatel vidí jen svoje žádosti" on verification_requests for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Uživatel žádá jen sám za sebe" on verification_requests for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Titulky (přidává tvůrce ručně při nahrávání)
alter table videos add column if not exists captions jsonb default '[]';

-- Až budeš chtít, aby ses stal administrátorem, spusť tohle a nahraď
-- svým skutečným user id (najdeš ho v Supabase -> Authentication -> Users):
-- update profiles set is_admin = true where id = 'TVOJE-USER-ID';

