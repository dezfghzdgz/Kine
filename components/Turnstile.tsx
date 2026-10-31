'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Cloudflare Turnstile - ochrana proti botům u registrace, přihlášení a
 * obnovy hesla (zdarma, bez obrázků k rozklikávání). Většina lidí nic
 * neuvidí (ověří se samo na pozadí), jen podezřelý provoz dostane políčko.
 *
 * Token jde do Supabase (captchaToken) - Supabase ho ověří tajným klíčem
 * (Authentication -> Bot and Abuse Protection). Bez NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * se nevykreslí nic a všechno jede jako dřív.
 */

export const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export type TurnstileHandle = { reset: () => void };

/** Chyba od Supabase kvůli ověření (chybí / neplatný / použitý token). */
export function isCaptchaError(message: string | null | undefined): boolean {
  return /captcha/i.test(message ?? '');
}

const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void; action: string }>(function Turnstile({ onToken, action }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useImperativeHandle(ref, () => ({
    // Token platí jen na jeden pokus - po každém odeslání nový.
    reset: () => {
      callback.current(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: 'auto',
          size: 'flexible',
          appearance: 'interaction-only',
          language: 'auto',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
          'timeout-callback': () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) {
        try {
          window.turnstile.remove(widget.current);
        } catch {
          /* už pryč */
        }
      }
      widget.current = null;
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="turnstile-box" />;
});

export default Turnstile;
