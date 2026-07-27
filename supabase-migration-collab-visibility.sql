-- Appka si sem uloží, jakou viditelnost video mělo mít, zatímco čeká na
-- potvrzení od spolutvůrce - samotné video appka mezitím drží jako
-- soukromé, a viditelnost vrátí zpátky, až všichni spolutvůrci potvrdí.
alter table videos add column if not exists pending_collab_visibility text;
