-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
--
-- Spolupráce na videu: pojistky přímo v databázi.
--
-- 1) Na jednom videu se můžou podílet nejvýš 4 tvůrci - ten, kdo ho nahrál,
--    a k tomu tři spolutvůrci. Appka to hlídá i v prohlížeči, ale tady je to
--    pojištěné natvrdo, aby to nešlo obejít.
-- 2) Pozvaný smí sám sebe ze spolupráce odebrat (odmítnutí pozvánky). Dřív
--    mohl řádek smazat jen vlastník videa, takže odmítnutí muselo jít oklikou
--    přes server.

create or replace function enforce_collaborator_limit() returns trigger as $$
declare
  current_count int;
begin
  select count(*) into current_count
  from video_collaborators
  where video_id = new.video_id;

  if current_count >= 3 then
    raise exception 'Na jednom videu se můžou podílet nejvýš 4 tvůrci (vlastník a 3 spolutvůrci).';
  end if;

  -- Vlastníka videa nemá smysl přidávat jako spolutvůrce sebe sama.
  if exists (select 1 from videos where videos.id = new.video_id and videos.owner_id = new.profile_id) then
    raise exception 'Vlastník videa už je jeho tvůrce, jako spolutvůrce se přidávat nemusí.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_collaborator_limit on video_collaborators;
create trigger trg_enforce_collaborator_limit
  before insert on video_collaborators
  for each row execute function enforce_collaborator_limit();

do $$ begin
  create policy "Pozvaný spolutvůrce se může sám odebrat" on video_collaborators for delete
  using (auth.uid() = profile_id);
exception when duplicate_object then null; end $$;
