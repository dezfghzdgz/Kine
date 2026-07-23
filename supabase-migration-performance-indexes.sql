-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- Indexy zrychlí appku, jakmile bude mít appka stovky/tisíce záznamů.
-- Nic nemění na chování appky, jen pomáhá databázi rychleji hledat.

create index if not exists idx_videos_created_at on videos (created_at desc);
create index if not exists idx_videos_views on videos (views desc);
create index if not exists idx_videos_owner_id on videos (owner_id);
create index if not exists idx_videos_status_visibility on videos (status, visibility);

create index if not exists idx_comments_video_id on comments (video_id);
create index if not exists idx_comments_post_id on comments (post_id);
create index if not exists idx_comments_created_at on comments (created_at desc);

create index if not exists idx_subscriptions_channel_id on subscriptions (channel_id);
create index if not exists idx_subscriptions_subscriber_id on subscriptions (subscriber_id);

create index if not exists idx_video_reactions_video_id on video_reactions (video_id);
create index if not exists idx_notifications_user_id_created on notifications (user_id, created_at desc);
create index if not exists idx_watch_history_user_id on watch_history (user_id, watched_at desc);
create index if not exists idx_playlist_videos_playlist_id on playlist_videos (playlist_id, position);

-- Fulltext hledání v názvech videí (rychlejší než "ilike '%text%'" u velkého množství videí)
create index if not exists idx_videos_title_search on videos using gin (to_tsvector('simple', title));
