-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- KRITICKÁ OPRAVA: dosavadní pravidlo dovolovalo vidět úplně všechna videa
-- všem, bez ohledu na nastavení viditelnosti. Nahrazujeme ho správným pravidlem.

drop policy if exists "Videa jsou veřejně viditelná" on videos;

create policy "Videa jsou viditelná podle nastavení soukromí" on videos for select
using (
  visibility = 'public'
  or owner_id = auth.uid()
  or (
    visibility = 'subscribers'
    and exists (
      select 1 from subscriptions
      where subscriptions.channel_id = videos.owner_id
      and subscriptions.subscriber_id = auth.uid()
    )
  )
);
