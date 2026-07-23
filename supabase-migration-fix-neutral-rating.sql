-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Oprava: 3 hvězdičky (neutrální hodnocení) posílají reaction=null,
-- ale původní pravidlo to zakazovalo (vyžadovalo vždy 'like' nebo 'dislike').

alter table video_reactions alter column reaction drop not null;
alter table video_reactions drop constraint if exists video_reactions_reaction_check;
alter table video_reactions add constraint video_reactions_reaction_check
  check (reaction is null or reaction in ('like', 'dislike'));
