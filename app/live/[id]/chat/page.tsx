'use client';

import { Suspense, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import LiveChat from '@/components/LiveChat';
import { channelRoom } from '@/lib/liveChat';
import { parseTtsMode } from '@/lib/chatSpeech';

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

  useEffect(() => {
    // OBS i okno chatu: bez posuvníků stránky a v překryvu průhledné pozadí.
    document.documentElement.classList.add(overlay ? 'chat-overlay-page' : 'chat-popout-page');
    return () => document.documentElement.classList.remove('chat-overlay-page', 'chat-popout-page');
  }, [overlay]);

  if (!/^[0-9a-f-]{36}$/i.test(channelId)) return null;
  return <LiveChat room={channelRoom(channelId)} variant={overlay ? 'overlay' : 'popout'} tts={overlay ? tts : undefined} />;
}
