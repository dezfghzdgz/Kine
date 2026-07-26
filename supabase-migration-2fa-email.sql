-- Jednoduchý přepínač pro dvoufázové ověření přes email kód
-- (místo autentizační appky).
alter table profiles
  add column if not exists two_factor_email_enabled boolean not null default false;
