'use client';

import { authHeaders } from './authHeaders';

/**
 * Push oznámení v prohlížeči (service worker public/kine-sw.js, server
 * /api/push/*). Zapíná se jen na klik (Nastavení -> Oznámení, nabídka ve
 * zvonečku) - prohlížeč se na povolení nikdy nezeptá sám od sebe.
 *
 * iPhone/iPad: Safari pošle oznámení jen webu přidanému na plochu jako
 * appka (iOS 16.4+); v běžném Safari je pushSupported() false.
 */

const VAPID_PUBLIC = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
const ON_KEY = 'kine-push-on';
const SYNC_KEY = 'kine-push-sync';
const DISMISS_KEY = 'kine-push-prompt-dismissed';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* anonymní okno - bez paměti */
  }
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!VAPID_PUBLIC &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(base64url: string): Uint8Array {
  const s = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  const reg = existing ?? (await navigator.serviceWorker.register('/kine-sw.js', { scope: '/' }));
  await navigator.serviceWorker.ready;
  return reg;
}

/** Přihlášení k push službě prohlížeče (nové, když se změnil klíč serveru). */
async function subscription(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = keyBytes(VAPID_PUBLIC);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
}

async function sendToServer(sub: PushSubscription, lang: string): Promise<boolean> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), lang }),
  });
  return res.ok;
}

/** Jsou oznámení v tomhle prohlížeči zapnutá? */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || read(ON_KEY) !== '1') return 'off';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Zapnout (jen po kliknutí - prohlížeč se zeptá na povolení). */
export async function enablePush(lang: string): Promise<'on' | 'denied' | 'error'> {
  if (!pushSupported()) return 'error';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'error';
    const reg = await registration();
    const sub = await subscription(reg);
    if (!(await sendToServer(sub, lang))) return 'error';
    store(ON_KEY, '1');
    store(SYNC_KEY, String(Date.now()));
    return 'on';
  } catch {
    return 'error';
  }
}

/** Vypnout v tomhle prohlížeči. */
export async function disablePush(): Promise<void> {
  store(ON_KEY, null);
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch {
    /* nic */
  }
}

/**
 * Po startu Kine (jednou za den): když jsou oznámení zapnutá, obnoví
 * přihlášení u serveru - prohlížeč adresu občas změní a jazyk se mohl změnit.
 */
export async function syncPush(lang: string): Promise<void> {
  if (!pushSupported() || read(ON_KEY) !== '1' || Notification.permission !== 'granted') return;
  const last = Number(read(SYNC_KEY) ?? 0);
  if (Date.now() - last < 24 * 3600 * 1000) return;
  try {
    const reg = await registration();
    const sub = await subscription(reg);
    if (await sendToServer(sub, lang)) store(SYNC_KEY, String(Date.now()));
  } catch {
    /* příště */
  }
}

/** Service worker ohlásil novou adresu (prohlížeč ji obnovil) - pošli ji serveru. */
export function listenForPushResubscribe(lang: string): () => void {
  if (!pushSupported()) return () => {};
  const handler = (e: MessageEvent) => {
    const data = e.data as { type?: string; subscription?: unknown } | null;
    if (data?.type !== 'kine-push-resubscribe' || read(ON_KEY) !== '1') return;
    void (async () => {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: data.subscription, lang }),
      }).catch(() => {});
    })();
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

/** Zkušební oznámení na všechna moje zařízení. */
export async function testPush(): Promise<{ devices: number; sent: number } | null> {
  try {
    const res = await fetch('/api/push/test', { method: 'POST', headers: await authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Po vložení oznámení pro někoho jiného (odpověď, pozvánka): ať mu dorazí
 * i na telefon. Na výsledek se nečeká, chyba nevadí.
 */
export function flushPush(): void {
  void authHeaders()
    .then((headers) => fetch('/api/push/flush', { method: 'POST', headers, keepalive: true }))
    .catch(() => {});
}

/** Nabídka ve zvonečku: ukázat? (podporované, ještě nerozhodnuto, nezavřené) */
export function shouldOfferPush(): boolean {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'default') return false;
  const dismissed = Number(read(DISMISS_KEY) ?? 0);
  return !dismissed || Date.now() - dismissed > 30 * 24 * 3600 * 1000;
}

export function dismissPushOffer(): void {
  store(DISMISS_KEY, String(Date.now()));
}
