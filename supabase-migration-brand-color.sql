-- Uloží si vlastní barvu appky Kine přímo na účet uživatele, ať se
-- projeví na všech jeho zařízeních (ne jen v jednom prohlížeči).
alter table profiles
  add column if not exists brand_color text;
