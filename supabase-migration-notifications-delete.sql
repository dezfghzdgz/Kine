-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
do $$ begin
  create policy "Uživatel maže jen svoje notifikace" on notifications for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
