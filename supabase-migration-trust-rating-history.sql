-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

create table if not exists trust_rating_snapshots (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid references profiles(id) on delete cascade not null,
  score int not null,
  recorded_date date not null default current_date,
  unique (profile_id, recorded_date)
);

alter table trust_rating_snapshots enable row level security;

do $$ begin
  create policy "Kredit historie je veřejně viditelná" on trust_rating_snapshots for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel zapisuje jen svůj vlastní snímek" on trust_rating_snapshots for insert with check (auth.uid() = profile_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Uživatel upravuje jen svůj vlastní snímek" on trust_rating_snapshots for update using (auth.uid() = profile_id);
exception when duplicate_object then null; end $$;
