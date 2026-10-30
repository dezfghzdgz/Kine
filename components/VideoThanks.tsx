'use client';

import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '@/lib/authHeaders';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import { formatTipAmount } from '@/lib/liveTips';
import { CREATOR_PAYMENTS_ENABLED } from '@/lib/payments';
import LiveTipDialog from './LiveTipDialog';
import ProfileImage from './ProfileImage';

/**
 * Super díky pod videem (jako Super Thanks na YouTube) - tlačítko u videa
 * a zvýrazněné vzkazy pod ním. Data: GET /api/videos/thanks; platba přes
 * LiveTipDialog (stejné částky a poplatek jako podpory ve vysílání).
 * Bez peněz pro tvůrce (NEXT_PUBLIC_CREATOR_PAYMENTS) se nic neukáže.
 */

type ThanksItem = { id: number; amountCents: number; currency: string; message: string; paidAt: string | null; name: string | null; avatar: string | null };
type ThanksData = { enabled: boolean; canReceive: boolean; feePercent: number; items: ThanksItem[] };

// Tlačítko i seznam se ptají na totéž - jeden dotaz na video, platí minutu (a znovu po zaplacení).
// Nepovedený dotaz se nepamatuje, ať tlačítko po výpadku nezmizí až do obnovení stránky.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<ThanksData | null> }>();

function fetchThanks(videoId: string, fresh = false): Promise<ThanksData | null> {
  const hit = cache.get(videoId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = fetch(`/api/videos/thanks?videoId=${encodeURIComponent(videoId)}`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<ThanksData>) : null))
    .catch(() => null)
    .then((d) => {
      if (!d) cache.delete(videoId);
      return d;
    });
  cache.set(videoId, { at: Date.now(), promise });
  return promise;
}

function useThanks(videoId: string) {
  const [data, setData] = useState<ThanksData | null>(null);
  const reload = useCallback(
    (fresh = false) => {
      let alive = true;
      fetchThanks(videoId, fresh).then((d) => alive && setData(d));
      return () => {
        alive = false;
      };
    },
    [videoId]
  );
  useEffect(() => {
    if (!CREATOR_PAYMENTS_ENABLED) return;
    return reload(false);
  }, [reload]);
  return { data, reload };
}

/** Tlačítko „Super díky“ v řadě u videa - jen když tvůrce může peníze přijímat a nejde o vlastní video. */
export function VideoThanksButton({ videoId, channelId, channelName, isOwner, loggedIn }: { videoId: string; channelId: string; channelName: string; isOwner: boolean; loggedIn: boolean }) {
  const { t } = useLanguage();
  const { data } = useThanks(videoId);
  const [open, setOpen] = useState(false);
  if (!CREATOR_PAYMENTS_ENABLED || isOwner || !data?.enabled || !data.canReceive) return null;
  return (
    <>
      <button type="button" className="reaction-btn thanks-btn" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20.5s-7-4.35-7-10.05A4.2 4.2 0 0 1 12 7.9a4.2 4.2 0 0 1 7 2.55c0 5.7-7 10.05-7 10.05Z" />
          <path d="M12 10.6v4.8M10.2 12.1h3.1a1.1 1.1 0 0 1 0 2.2h-1.9" />
        </svg>
        {t('superThanksButton')}
      </button>
      {open && <LiveTipDialog channelId={channelId} channelName={channelName} feePercent={data.feePercent} loggedIn={loggedIn} onClose={() => setOpen(false)} videoId={videoId} />}
    </>
  );
}

/** Zaplacené Super díky pod videem (nejnovější nahoře) + poděkování po návratu ze Stripe. Tvůrce a moderátor je můžou skrýt. */
export function VideoThanksList({ videoId, canModerate = false }: { videoId: string; canModerate?: boolean }) {
  const { t, lang } = useLanguage();
  const params = useSearchParams();
  // „Díky“ jen jednou: parametr ?thanks=1 se hned z adresy smaže (obnovení stránky ani sdílený odkaz ho neukáže znovu).
  const [justPaid] = useState(() => params.get('thanks') === '1');
  const { data, reload } = useThanks(videoId);

  useEffect(() => {
    if (!justPaid) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('thanks');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      // nic - jen kosmetika adresy
    }
  }, [justPaid]);

  async function hide(id: number) {
    const res = await fetch('/api/videos/thanks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ id, hidden: true }),
    }).catch(() => null);
    if (res?.ok) reload(true);
  }

  useEffect(() => {
    if (!justPaid || !CREATOR_PAYMENTS_ENABLED) return;
    // Webhook od Stripe přijde o pár sekund později než návrat - zkusit znovu.
    const timers = [3000, 8000, 15000].map((ms) => setTimeout(() => reload(true), ms));
    return () => timers.forEach(clearTimeout);
  }, [justPaid, reload]);

  if (!CREATOR_PAYMENTS_ENABLED || !data?.enabled) return null;
  const items = data.items ?? [];
  if (items.length === 0 && !justPaid) return null;

  return (
    <section className="panel thanks-list" aria-label={t('superThanksButton')}>
      <p className="panel-heading" style={{ margin: 0 }}>
        💛 {t('superThanksButton')}
      </p>
      {justPaid && <p className="thanks-sent">{t('superThanksSent')}</p>}
      {items.map((item) => (
        <div key={item.id} className="thanks-item">
          <span className="thanks-avatar" aria-hidden="true">
            {item.avatar ? <ProfileImage src={item.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </span>
          <div className="thanks-body">
            <div className="thanks-meta">
              <span className="thanks-name">{item.name || t('superThanksAnon')}</span>
              <span className="thanks-amount">{formatTipAmount(item.amountCents, item.currency, lang === 'en' ? 'en-GB' : lang)}</span>
              {canModerate && (
                <button type="button" className="thanks-hide" onClick={() => hide(item.id)}>
                  {t('superThanksHide')}
                </button>
              )}
            </div>
            {item.message && <p className="thanks-message">{item.message}</p>}
          </div>
        </div>
      ))}
    </section>
  );
}
