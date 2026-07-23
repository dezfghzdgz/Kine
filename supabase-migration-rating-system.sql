-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query

-- Uživatelská preference hodnocení
alter table profiles add column if not exists rating_mode text check (rating_mode in ('stars', 'like_dislike'));

-- Číselné skóre 1-5 pro každou reakci (nahrazuje jen text 'like'/'dislike')
alter table video_reactions add column if not exists score int check (score between 1 and 5);

-- Doplň skóre ke starým reakcím, co ho ještě nemají
update video_reactions set score = 5 where reaction = 'like' and score is null;
update video_reactions set score = 1 where reaction = 'dislike' and score is null;
