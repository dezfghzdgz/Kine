'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import LiveChat from '@/components/LiveChat';
import { channelRoom } from '@/lib/liveChat';
import { parseTtsMode } from '@/lib/chatSpeech';
import { authHeaders } from '@/lib/authHeaders';
import { useLanguage } from '@/lib/i18n';

/** Jak často se okno chatu ptá, jestli vysílání začalo / skončilo (každé vysílání má svůj chat). */
const SESSION_REFRESH_MS = 15 * 1000;

/**
 * Chat přenosu v samostatném okně (tlačítko ⧉ u chatu, appka Kine) a jako
 * průhledný překryv pro OBS: /live/<kanál>/chat?overlay=1 - Zdroj
 * prohlížeče v OBS, jen zprávy na průhledném pozadí. Bez menu a lišt
 * (components/AppShellChrome.tsx).
 */
export default function LiveChatPopoutPage() {
  // useSearchParams potřebuje Suspense (jinak Next při sestavení protestuje).
  return (
    <Suspense fallback={null}>
      <LiveChatPopout />
    </Suspense>
  );
}

function LiveChatPopout() {
  const params = useParams();
  const search = useSearchParams();
  const channelId = String(params.id ?? '');
  const overlay = search.get('overlay') === '1';
  // Překryv pro OBS umí číst podpory / zprávy nahlas: ?overlay=1&tts=tips (nebo tts=all).
  const tts = parseTtsMode(search.get('tts'));
  const { t } = useLanguage();
  const valid = /^[0-9a-f-]{36}$/i.test(channelId);
  // Od kdy ukazovat zprávy: chat patří k jednomu vysílání (po konci začíná nanovo).
  const [session, setSession] = useState<{ since: string | null; ended: boolean } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const fallback = () => setSession((current) => current ?? { since: null, ended: false });
    async function load() {
      try {
        const res = await fetch(`/api/live/status?channel=${encodeURIComponent(channelId)}`, { cache: 'no-store', headers: await authHeaders() });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) return fallback();
        setSession({ since: body.stream?.chatSince ?? null, ended: !body.live && !!body.stream?.endedAt });
      } catch {
        if (!cancelled) fallback();
      }
    }
    load();
    const timer = setInterval(load, SESSION_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channelId, valid]);

  useEffect(() => {
    // OBS i okno chatu: bez posuvníků stránky a v překryvu průhledné pozadí.
    document.documentElement.classList.add(overlay ? 'chat-overlay-page' : 'chat-popout-page');
    return () => document.documentElement.classList.remove('chat-overlay-page', 'chat-popout-page');
  }, [overlay]);

  if (!valid || !session) return null;
  return (
    <LiveChat
      room={channelRoom(channelId)}
      variant={overlay ? 'overlay' : 'popout'}
      tts={overlay ? tts : undefined}
      since={session.since}
      note={!overlay && session.ended ? t('liveChatFreshOffline') : null}
    />
  );
}
