-- Appka si u každého odběru drží, jestli chce ten člověk dostávat
-- oznámení o nových videích od toho konkrétního tvůrce - přesně jako
-- zvoneček vedle "Odebírat" na appka YouTube.
alter table subscriptions add column if not exists notify_new_videos boolean not null default true;
