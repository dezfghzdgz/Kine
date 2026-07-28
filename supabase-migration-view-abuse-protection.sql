-- Bezpečnostní oprava 1: appka na počítání zhlédnutí neměla žádnou
-- ochranu na straně serveru - appka šlo zavolat přímo (bez otevření
-- videa v appce appka), a klidně opakovaně navýšit počet zhlédnutí u
-- kteréhokoliv videa. Appka teď hlídá appky IP adresu, ať pozná,
-- jestli appka odsud appka video nedávno počítala.
alter table views_log add column if not exists ip_address text;

create index if not exists idx_views_log_video_ip_time on views_log (video_id, ip_address, viewed_at);

-- Druhá díra: appka na uzamčení účtu šlo zavolat přímo (bez skutečného
-- pokusu o přihlášení) - appka tak mohl kdokoliv, kdo zná jen email,
-- uzamknout cizí účet. Appka teď hlídá i to, kolikrát se ozvala stejná
-- adresa (IP) za hodinu.
create table if not exists login_attempt_ip_log (
  id uuid default gen_random_uuid() primary key,
  ip_address text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_attempt_ip_time on login_attempt_ip_log (ip_address, created_at);
alter table login_attempt_ip_log enable row level security;
-- Žádný přímý přístup z appky (anon klíč) - appka se k tabulce dostane
-- jen přes vlastní server (service role).
