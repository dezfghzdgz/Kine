'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import VideoCard from '@/components/VideoCard';
import { pickContinueWatching, type ContinueItem, type HistoryRow } from '@/lib/continueWatching';
import { formatDuration } from '@/lib/homeRecommendation';

/**
 * Řádek "Pokračovat ve sledování" na hlavní stránce.
 *
 * Pozici ve videu appka ukládá do databáze (a proto navazuje i na jiném
 * zařízení), ale na Home s tím nic nebylo. Netflix na tomhle řádku stojí:
 * člověk otevře appku a první, co vidí, je "tady jsi skončil".
 *
 * Jen pro přihlášené a jen když je co dokoukat - jinak se nevykreslí nic,
 * ani nadpis. Co do řádku patří, rozhoduje lib/continueWatching.ts (a má
 * na to test); tady je jen načtení a vykreslení.
 */
export default function ContinueWatching() {
  const { t } = useLanguage();
  const [items, setItems] = useState<ContinueItem[] | null>(null);

  useEffect(() => {
    let zruseno = false;

    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        if (!zruseno) setItems([]);
        return;
      }

      // Řádků se bere víc, než se ukáže: část odpadne (dokoukané, sotva
      // načaté, nehotová videa) a řádek by jinak zůstal poloprázdný.
      const { data, error } = await supabase
        .from('watch_history')
        .select(
          'video_id, progress_seconds, completed, watched_at, ' +
            'videos(id, title, thumbnail_url, views, duration_seconds, width, height, owner_id, ' +
            'cloudflare_video_id, status, profiles!videos_owner_id_fkey(username))'
        )
        .eq('user_id', authData.user.id)
        .eq('completed', false)
        .gt('progress_seconds', 0)
        .order('watched_at', { ascending: false })
        .limit(40);

      if (zruseno) return;
      // Chyba tady nemá být vidět: řádek je bonus, hlavní stránka se bez
      // něj obejde a vlastní chybu hlásí sama.
      if (error || !data) {
        setItems([]);
        return;
      }

      setItems(pickContinueWatching(data as unknown as HistoryRow[]));
    })();

    return () => {
      zruseno = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section className="continue-section" aria-label={t('continueWatchingHeading')}>
      <p className="section-title">{t('continueWatchingHeading')}</p>
      <div className="continue-row">
        {items.map((item) => (
          <VideoCard
            key={item.video.id}
            video={item.video}
            href={`/watch/${item.video.id}?t=${item.resumeAt}`}
            progressPercent={item.percent}
            formatDuration={formatDuration}
          />
        ))}
      </div>
    </section>
  );
}
