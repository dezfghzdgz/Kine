-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Dá se spustit opakovaně, nic nerozbije.
--
-- PODEPSANÉ ADRESY PRO NEVEŘEJNÁ VIDEA (lib/streamProtection.ts)
--
-- Soukromé video a video jen pro odběratele hlídala jen databáze: kdo
-- nemá právo, nedostane řádek. Jenže samotné video hraje z Cloudflare a
-- stačí mu id - kdo ho jednou viděl, mohl ho pouštět dál a poslat komukoliv.
--
-- Odteď (po nastavení podpisového klíče, postup je v lib/streamProtection.ts)
-- Cloudflare neveřejné video bez platného tokenu nevydá. Token dává Kine
-- jen tomu, komu databáze video ukáže.
--
-- Tenhle sloupec si pamatuje, u kterých videí už je ochrana u Cloudflare
-- zapnutá, ať se to nenastavuje pořád dokola. Bez něj appka funguje taky
-- (jen se Cloudflare ptá častěji).

alter table videos add column if not exists signed_urls boolean not null default false;

comment on column videos.signed_urls is
  'Cloudflare Stream requireSignedURLs je zapnuté - video hraje jen s tokenem (lib/streamProtection.ts).';
