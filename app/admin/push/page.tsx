'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { generateVapidKeys } from '@/lib/vapidKeygen';
import UiIcon from '@/components/UiIcon';

type Status = { configured: boolean; publicKeySet: boolean; privateKeySet: boolean; migrated: boolean; devices: number };

function CopyField({ name, value, label, copied }: { name: string; value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="admin-key-field">
      <code className="admin-key-name">{name}</code>
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={name} />
      <button
        type="button"
        className="secondary"
        onClick={() => navigator.clipboard?.writeText(value).then(() => setDone(true), () => setDone(false))}
      >
        {done ? copied : label}
      </button>
    </div>
  );
}

/**
 * Admin -> Push oznámení: stav (klíče ve Vercelu, migrace, kolik zařízení)
 * a vygenerování klíčů VAPID. Klíče vzniknou tady v prohlížeči - soukromý
 * neprojde serverem; správce ho zkopíruje rovnou do Vercelu.
 */
export default function AdminPushPage() {
  const { lang } = useLanguage();
  const cs = lang === 'cs' || lang === 'sk';
  const tx = (czech: string, english: string) => (cs ? czech : english);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) return setChecking(false);
      const res = await fetch('/api/admin/push', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (res.ok) {
        setIsAdmin(true);
        setStatus(await res.json());
      }
      setChecking(false);
    })();
  }, []);

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>{tx('Načítám…', 'Loading…')}</p>;
  if (!isAdmin) return <div className="auth-gate"><p>{tx('Jen pro správce.', 'Admins only.')}</p></div>;

  const ok = (yes: boolean) => <span className={`admin-pill${yes ? ' ok' : ' bad'}`}>{yes ? tx('hotovo', 'done') : tx('chybí', 'missing')}</span>;

  return (
    <div className="admin-page" style={{ maxWidth: 760 }}>
      <h1 className="admin-title">
        <UiIcon name="bell" size={22} /> {tx('Push oznámení', 'Push notifications')}
      </h1>
      <p className="admin-lead">
        {tx(
          'Oznámení na telefon a počítač (je živě, nové video a příspěvek, komentáře, podpory) - i když Kine není otevřené. Každý si je zapne sám v Nastavení -> Oznámení.',
          'Notifications on phones and computers (live, new videos and posts, comments, tips) - even when Kine is closed. Everyone turns them on in Settings -> Notifications.'
        )}
      </p>

      {status && (
        <div className="panel admin-status">
          <div>{tx('Klíč NEXT_PUBLIC_VAPID_PUBLIC_KEY ve Vercelu', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel')} {ok(status.publicKeySet)}</div>
          <div>{tx('Klíč VAPID_PRIVATE_KEY ve Vercelu', 'VAPID_PRIVATE_KEY in Vercel')} {ok(status.privateKeySet)}</div>
          <div>{tx('Migrace supabase-migration-push-hry-naklady.sql', 'Migration supabase-migration-push-hry-naklady.sql')} {ok(status.migrated)}</div>
          <div>
            {tx('Zařízení se zapnutými oznámeními', 'Devices with notifications on')}: <b>{status.devices}</b>
          </div>
          {status.configured && status.migrated && (
            <p className="admin-ok">{tx('Všechno nastavené - oznámení se posílají.', 'All set - notifications are being sent.')}</p>
          )}
        </div>
      )}

      <div className="panel">
        <p className="panel-heading">{tx('1. Vygeneruj klíče', '1. Generate keys')}</p>
        <p className="admin-note">
          {tx(
            'Jen jednou. Když klíče později vyměníš, oznámení si všichni musí zapnout znovu.',
            'Only once. If you replace the keys later, everyone has to turn notifications on again.'
          )}
        </p>
        {!keys ? (
          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                setKeys(await generateVapidKeys());
              } catch {
                setError(tx('Tenhle prohlížeč klíče vytvořit neumí - zkus Chrome nebo Edge.', 'This browser cannot create keys - try Chrome or Edge.'));
              }
            }}
          >
            <UiIcon name="sparkle" size={15} /> {tx('Vygenerovat klíče', 'Generate keys')}
          </button>
        ) : (
          <div className="admin-keys">
            <CopyField name="NEXT_PUBLIC_VAPID_PUBLIC_KEY" value={keys.publicKey} label={tx('Kopírovat', 'Copy')} copied={tx('Zkopírováno', 'Copied')} />
            <CopyField name="VAPID_PRIVATE_KEY" value={keys.privateKey} label={tx('Kopírovat', 'Copy')} copied={tx('Zkopírováno', 'Copied')} />
            <p className="admin-warn">
              <UiIcon name="lock" size={14} />{' '}
              {tx(
                'Soukromý klíč (VAPID_PRIVATE_KEY) nikam jinam neposílej - patří jen do Vercelu. Po zavření stránky se tady už neukáže.',
                'Never share the private key (VAPID_PRIVATE_KEY) - it belongs only in Vercel. It will not be shown again after you leave this page.'
              )}
            </p>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="panel">
        <p className="panel-heading">{tx('2. Vlož je do Vercelu', '2. Add them to Vercel')}</p>
        <ol className="admin-steps">
          <li>{tx('Vercel -> projekt Kine -> Settings -> Environment Variables.', 'Vercel -> Kine project -> Settings -> Environment Variables.')}</li>
          <li>{tx('Přidej oba klíče (název vlevo, hodnota vpravo), prostředí Production.', 'Add both keys (name on the left, value on the right), Production environment.')}</li>
          <li>{tx('Deployments -> u posledního ⋯ -> Redeploy.', 'Deployments -> ⋯ on the latest -> Redeploy.')}</li>
          <li>
            {tx('Pak si oznámení zapni v ', 'Then turn notifications on in ')}
            <Link href="/settings#notifications">{tx('Nastavení -> Oznámení', 'Settings -> Notifications')}</Link>
            {tx(' a zkus „Poslat zkušební“.', ' and try "Send test".')}
          </li>
        </ol>
      </div>
    </div>
  );
}
