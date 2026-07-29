-- Rozšiřuje povolené typy oznámení o budoucí funkce (dary, předplatné,
-- milníky lajků, nová videa, odpovědi na komentáře), aby appka mohla
-- každý typ v seznamu odlišit barvou a ikonkou.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'donation', 'subscription', 'new_video', 'comment_reply'));
