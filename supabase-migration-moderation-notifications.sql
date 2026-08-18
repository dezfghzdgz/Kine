-- Rozšiřuje povolené typy oznámení o appka moderátorské varování
-- (appka shadow ban, pozastavení výdělků, zablokování účtu).
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('default', 'collab_invite', 'like_milestone', 'donation', 'subscription', 'new_video', 'comment_reply', 'moderation_warning'));
