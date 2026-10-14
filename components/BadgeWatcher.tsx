'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import type { Badge } from '@/lib/badges';
import { badgeTexts } from '@/lib/badgeText';
import { BadgePill } from './ChannelBadges';
import UiIcon from './UiIcon';

/** Kanál majitele po načtení řekne "zkontroluj hned" (čísla jsou čerstvá). */
export const BADGE_CHECK_EVENT = 'kine-badge-check';
/** Oznámení si zvoneček načte hned, ne až za 30 s. */
export const NOTIFICATIONS_REFRESH_EVENT = 'kine-notifications-refresh';

const THROTTLE_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;
const SHOW_MS = 9000;

/**
 * Hlídá nové odznaky přihlášeného (app/api/badges/check, lib/badgeCheck.ts):
 * chvíli po otevření Kine, při návratu do okna (nejvýš jednou za půl hodiny)
 * a hned, když majitel otevře svůj kanál. Nový odznak = oslavné okénko jako
 * ve hrách (a oznámení ve zvonečku, to pošle server).
 */
export default function BadgeWatcher() {
  const { t, lang } = useLanguage();
  const [fresh, setFresh] = useState<{ badges: Badge[]; userId: string } | null>(null);
  const lastRun = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run(force: boolean) {
      const now = Date.now();
      if (now - lastRun.current < MIN_GAP_MS) return;
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session || cancelled) return;
      const key = `kine-badge-check:${session.user.id}`;
      try {
        const last = Number(localStorage.getItem(key)) || 0;
        if (!force && now - last < THROTTLE_MS) return;
        localStorage.setItem(key, String(now));
      } catch {
        // bez paměti prohlížeče hlídá jen MIN_GAP_MS
      }
      lastRun.current = now;
      const res = await fetch('/api/badges/check', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => null);
      if (!res?.ok || cancelled) return;
      const body = await res.json().catch(() => null);
      if (!body?.ok) return;
      if ((Array.isArray(body.fresh) && body.fresh.length > 0) || body.first) {
        window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
      }
      if (Array.isArray(body.fresh) && body.fresh.length > 0) {
        setFresh({ badges: body.fresh as Badge[], userId: session.user.id });
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setFresh(null), SHOW_MS);
      }
    }

    const first = setTimeout(() => void run(false), 6000);
    const onFocus = () => void run(false);
    const onCheck = () => void run(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener(BADGE_CHECK_EVENT, onCheck);
    return () => {
      cancelled = true;
      clearTimeout(first);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(BADGE_CHECK_EVENT, onCheck);
    };
  }, []);

  if (!fresh) return null;
  const text = badgeTexts(t, lang);
  return (
    <div className="badge-toast" role="status" aria-live="polite">
      <span className="badge-toast-glow" aria-hidden="true" />
      <div className="badge-toast-head">
        <UiIcon name="trophy" size={18} />
        <span>{fresh.badges.length > 1 ? t('badgeNewTitleMany').replace('{n}', String(fresh.badges.length)) : t('badgeNewTitle')}</span>
        <button type="button" className="icon-btn badge-toast-close" onClick={() => setFresh(null)} aria-label={t('close')}>
          <UiIcon name="close" size={14} />
        </button>
      </div>
      <div className="badge-toast-badges">
        {fresh.badges.slice(0, 3).map((b) => (
          <BadgePill key={`${b.id}:${b.value}`} badge={b} label={text.of(b).label} size="lg" />
        ))}
      </div>
      <Link href={`/channel/${fresh.userId}?badges=1`} className="badge-toast-link" onClick={() => setFresh(null)}>
        {t('badgeNewShow')}
        <UiIcon name="arrowRight" size={14} />
      </Link>
    </div>
  );
}
