-- Appka si tady drží počet neúspěšných pokusů o přihlášení pro každý email
-- a případně čas, do kdy je účet dočasně uzamčený.
create table if not exists login_lockouts (
  email text primary key,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table login_lockouts enable row level security;
-- Žádný přímý přístup z appky (anon klíč) - k tabulce se appka dostane jen
-- přes vlastní server (service role), takže tu žádnou policy pro anon/auth
-- záměrně nepřidáváme.
