-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- OZNÁMENÍ O PORUŠENÍ AUTORSKÝCH PRÁV (/copyright, app/api/copyright-notice)
--
-- Platforma, která hostí cizí videa, musí mít cestu, jak jí držitel práv
-- řekne "tohle je moje" - a musí ho vyřídit. V EU to je povinnost (DSA,
-- "notice and action"), v Česku autorský zákon. Není to cenzura názorů:
-- týká se to jen cizího díla nahraného bez svolení, a rozhoduje člověk
-- (moderátor), ne stroj.
--
-- Držitel práv obvykle nemá účet, formulář je proto bez přihlášení a
-- zapisuje se jen přes server (service role). Číst a vyřizovat smí jen
-- moderátoři a admini (is_staff() z privacy-fixes).

create table if not exists copyright_notices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  video_id uuid references videos(id) on delete set null,
  video_url text not null,
  claimant_name text not null,
  claimant_email text not null,
  claimant_org text,
  work_description text not null,
  good_faith boolean not null default false,
  status text not null default 'open' check (status in ('open', 'removed', 'rejected')),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,
  moderator_note text,
  -- Adresa, ze které oznámení přišlo, kvůli zneužití formuláře. Vidí ji jen moderátoři.
  sender_ip text
);

create index if not exists idx_copyright_notices_status on copyright_notices (status, created_at desc);
create index if not exists idx_copyright_notices_video on copyright_notices (video_id);

alter table copyright_notices enable row level security;

do $$ begin
  create policy "Moderátor vidí oznámení o autorských právech" on copyright_notices
    for select using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Moderátor vyřizuje oznámení o autorských právech" on copyright_notices
    for update using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

-- Vkládá jen server (service role obchází RLS) - žádná insert policy schválně.

comment on table copyright_notices is 'Oznámení držitelů práv (formulář /copyright). Vyřizují moderátoři v /reports.';
