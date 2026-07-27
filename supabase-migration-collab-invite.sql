-- Doplnění k video_collaborators: spolupráci teď musí druhá strana
-- potvrdit, než se video objeví na jejím kanálu.
alter table video_collaborators add column if not exists status text not null default 'pending' check (status in ('pending', 'accepted'));

do $$ begin
  create policy "Pozvaný spolutvůrce potvrzuje/odmítá sám sebe"
  on video_collaborators for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
exception when duplicate_object then null; end $$;

-- Rozlišení typu notifikace (appka teď umí zobrazit pozvánku ke
-- spolupráci jinak/barevně, s tlačítky Přijmout/Odmítnout).
alter table notifications add column if not exists type text not null default 'default' check (type in ('default', 'collab_invite'));
