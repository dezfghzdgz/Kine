'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';
import { liveClipFilename } from '@/lib/liveClip';
import UiIcon from './UiIcon';

type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done' }
  | { kind: 'link'; url: string; filename: string }
  | { kind: 'error'; text: string };

/**
 * „Klip“ u živého přenosu: jedním klikem stáhne posledních ~30 s do zařízení
 * (app/api/live/clip vrátí adresu MP4 od Cloudflare). Na Kine se nic
 * neukládá - klip nezabírá úložiště a nepřibude jako video na kanálu.
 *
 * Soubor se stáhne přes blob (funguje i pro adresu z jiné domény a dá se mu
 * dát jméno). Kdyby to prohlížeč nepustil (CORS, málo paměti), ukáže se
 * odkaz „Stáhnout klip“ - klepnutí na něj prohlížeč neblokuje.
 */
export default function LiveClipButton({ channelId, channelName, loggedIn }: { channelId: string; channelName?: string | null; loggedIn: boolean }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Hláška po chvíli zmizí (odkaz ke stažení vydrží déle).
  useEffect(() => {
    if (state.kind !== 'done' && state.kind !== 'error' && state.kind !== 'link') return;
    const timer = setTimeout(() => setState({ kind: 'idle' }), state.kind === 'link' ? 60000 : state.kind === 'done' ? 8000 : 7000);
    return () => clearTimeout(timer);
  }, [state]);

  async function clip() {
    setState({ kind: 'saving' });
    let url: string;
    // Jméno souboru podle místního času diváka (server zná jen svůj).
    const filename = liveClipFilename(channelName);
    try {
      const res = await fetch('/api/live/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ channel: channelId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.url !== 'string') {
        const code = body?.code;
        const text =
          code === 'too-early'
            ? t('liveClipTooEarly')
            : code === 'busy' || res.status === 429
              ? t('liveClipBusy')
              : code === 'not-live'
                ? t('liveClipNotLive')
                : code === 'blocked'
                  ? t('liveClipBlocked')
                  : t('liveClipFailed');
        setState({ kind: 'error', text });
        return;
      }
      url = body.url as string;
    } catch {
      setState({ kind: 'error', text: t('liveClipFailed') });
      return;
    }

    // Cloudflare klip vyrobí při prvním stažení (pár vteřin), pak se uloží do Stažených.
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (blob.size < 1024) throw new Error('empty');
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
      setState({ kind: 'done' });
    } catch {
      setState({ kind: 'link', url, filename });
    }
  }

  if (!loggedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}
        className="live-clip-btn"
        title={t('liveClipTitle')}
      >
        <UiIcon name="scissors" size={15} />
        {t('liveClipButton')}
      </Link>
    );
  }

  return (
    <span className="live-clip">
      <button type="button" className="live-clip-btn" onClick={clip} disabled={state.kind === 'saving'} title={t('liveClipTitle')} aria-label={t('liveClipTitle')}>
        {state.kind === 'saving' ? <span className="spin" aria-hidden="true" /> : <UiIcon name="scissors" size={15} />}
        {state.kind === 'saving' ? t('liveClipSaving') : t('liveClipButton')}
      </button>
      {state.kind === 'done' && (
        <span className="live-clip-note ok" role="status">
          <UiIcon name="check" size={14} />
          {t('liveClipSaved')}
        </span>
      )}
      {state.kind === 'link' && (
        <span className="live-clip-note ok" role="status">
          <UiIcon name="download" size={14} />
          <a href={state.url} download={state.filename} target="_blank" rel="noopener">
            {t('liveClipOpen')} →
          </a>
        </span>
      )}
      {state.kind === 'error' && (
        <span className="live-clip-note error" role="alert">
          {state.text}
        </span>
      )}
    </span>
  );
}
