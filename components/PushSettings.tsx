'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { disablePush, enablePush, pushState, pushSupported, testPush, type PushState } from '@/lib/pushClient';
import { currentInstallPlatform, requestInstall } from '@/lib/installApp';
import { PanelHeading } from './HelpTip';
import UiIcon from './UiIcon';

type Prefs = { live: boolean; uploads: boolean; replies: boolean; earnings: boolean };
const DEFAULT_PREFS: Prefs = { live: true, uploads: true, replies: true, earnings: true };

/** iPhone / iPad (i iPadOS, který se hlásí jako Mac s dotykem). */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Nastavení -> Oznámení: push oznámení v tomhle zařízení (zapnout / vypnout /
 * zkusit) a co posílat (živě, nová videa a příspěvky, komentáře, podpory).
 * Výběr druhů platí pro všechna zařízení účtu (tabulka push_settings).
 */
export default function PushSettings({ userId }: { userId: string }) {
  const { t, lang } = useLanguage();
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    void pushState().then(setState);
    void supabase
      .from('push_settings')
      .select('live, uploads, replies, earnings')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs({ ...DEFAULT_PREFS, ...(data as Prefs) });
      });
  }, [userId]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    const result = await enablePush(lang);
    setBusy(false);
    if (result === 'on') {
      setState('on');
      setMessage({ text: t('pushEnabledNote'), ok: true });
    } else if (result === 'denied') {
      setState('denied');
    } else {
      setMessage({ text: t('pushEnableFailed'), ok: false });
    }
  }

  async function turnOff() {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setState('off');
    setMessage(null);
  }

  async function test() {
    setBusy(true);
    const result = await testPush();
    setBusy(false);
    setMessage(result && result.sent > 0 ? { text: t('pushTestSent'), ok: true } : { text: t('pushTestFailed'), ok: false });
  }

  async function setPref(key: keyof Prefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await supabase.from('push_settings').upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() });
  }

  const supported = pushSupported();
  const rows: { key: keyof Prefs; icon: Parameters<typeof UiIcon>[0]['name']; label: string }[] = [
    { key: 'live', icon: 'broadcast', label: t('pushCatLive') },
    { key: 'uploads', icon: 'film', label: t('pushCatUploads') },
    { key: 'replies', icon: 'chat', label: t('pushCatReplies') },
    { key: 'earnings', icon: 'coins', label: t('pushCatEarnings') },
  ];

  return (
    <div className="settings-stack">
      <div className="panel">
        <PanelHeading icon="bell" title={t('pushHeading')} help={t('pushHelp')} />
        {state === 'loading' ? (
          <p className="push-note">{t('loading')}</p>
        ) : !supported ? (
          <>
            <p className="push-note">{isIos() ? t('pushIosNote') : t('pushUnsupportedNote')}</p>
            {/* iPhone v Safari: rovnou návod, jak Kine přidat na plochu (components/InstallAppHost.tsx). */}
            {isIos() && currentInstallPlatform() !== 'installed' && (
              <button type="button" className="secondary push-install-button" onClick={() => void requestInstall()}>
                <UiIcon name="phone" size={15} /> {t('installButton')}
              </button>
            )}
          </>
        ) : state === 'denied' ? (
          <p className="push-note push-warn">
            <UiIcon name="warning" size={15} /> {t('pushDeniedNote')}
          </p>
        ) : (
          <div className="push-device">
            <span className={`push-status${state === 'on' ? ' on' : ''}`}>
              <span className="push-status-dot" aria-hidden="true" />
              {state === 'on' ? t('pushOnHere') : t('pushOffHere')}
            </span>
            <div className="push-actions">
              {state === 'on' ? (
                <>
                  <button type="button" className="secondary" onClick={test} disabled={busy}>
                    {t('pushTestButton')}
                  </button>
                  <button type="button" className="secondary" onClick={turnOff} disabled={busy}>
                    {t('pushTurnOff')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={turnOn} disabled={busy}>
                  <UiIcon name="bell" size={15} /> {t('pushTurnOn')}
                </button>
              )}
            </div>
          </div>
        )}
        {message && <p className={`push-note${message.ok ? ' push-ok' : ' push-warn'}`}>{message.text}</p>}
      </div>

      <div className="panel">
        <PanelHeading icon="sliders" title={t('pushWhatHeading')} help={t('pushWhatHelp')} />
        <div className="push-prefs">
          {rows.map((r) => (
            <label key={r.key} className="settings-check push-pref">
              <input type="checkbox" checked={prefs[r.key]} onChange={(e) => void setPref(r.key, e.target.checked)} />
              <UiIcon name={r.icon} size={16} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
