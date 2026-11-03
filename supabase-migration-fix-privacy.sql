-- Spusť tento skript v Supabase dashboardu -> SQL Editor -> New Query
-- KRITICKÁ OPRAVA: dosavadní pravidlo dovolovalo vidět úplně všechna videa
-- všem, bez ohledu na nastavení viditelnosti. Nahrazujeme ho správným pravidlem.

drop policy if exists "Videa jsou veřejně viditelná" on videos;

-- POZOR (bezpečnost, listopad 2026): cizí člověk vidí jen HOTOVÁ a ZVEŘEJNĚNÁ
-- veřejná videa (ne rozpracovaná ani dopředu naplánovaná). Spolutvůrce doplňuje
-- supabase-migration-collab-rls-fix.sql; plnou verzi má supabase-migration-bezpecnost-listopad.sql (M3).
create policy "Videa jsou viditelná podle nastavení soukromí" on videos for select
using (
  owner_id = auth.uid()
  or (
    status = 'ready'
    and (scheduled_at is null or scheduled_at <= now() or is_premiere)
    and (
      visibility = 'public'
      or (
        visibility = 'subscribers'
        and exists (
          select 1 from subscriptions
          where subscriptions.channel_id = videos.owner_id
          and subscriptions.subscriber_id = auth.uid()
        )
      )
    )
  )
);
