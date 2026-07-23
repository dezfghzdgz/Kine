-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Přidává možnost lajkovat komentáře.

create table comment_reactions (
  comment_id uuid references comments(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamp with time zone default now(),
  primary key (comment_id, user_id)
);

alter table comment_reactions enable row level security;

create policy "Lajky komentářů jsou veřejně viditelné"
on comment_reactions for select using (true);

create policy "Přihlášený uživatel může lajkovat komentář"
on comment_reactions for insert with check (auth.uid() = user_id);

create policy "Uživatel maže jen svůj lajk"
on comment_reactions for delete using (auth.uid() = user_id);
