'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  GUEST_WELCOME_DAYS,
  GUEST_WELCOME_KEY,
  INSTALL_BANNER_DAYS,
  INSTALL_BANNER_KEY,
  dismissedRecently,
  pickHomeBanner,
  readStored,
  storeNow,
  type HomeBannerKind,
} from '@/lib/homeBanner';
import { INSTALL_READY_EVENT, appMarkedInstalled, canOfferInstall } from '@/lib/installApp';
import DesktopAppBanner from './DesktopAppBanner';
import GuestWelcome from './GuestWelcome';
import InstallAppBanner from './InstallAppBanner';

function decide(signedIn: boolean): HomeBannerKind {
  const now = Date.now();
  return pickHomeBanner({
    signedIn,
    guestDismissed: dismissedRecently(readStored(GUEST_WELCOME_KEY), now, GUEST_WELCOME_DAYS),
    offerInstall: canOfferInstall(),
    installDismissed: dismissedRecently(readStored(INSTALL_BANNER_KEY), now, INSTALL_BANNER_DAYS),
    installed: appMarkedInstalled(),
  });
}

/**
 * Pruh nahoře na Domovské: uvítání pro hosty, „přidat na plochu“ na telefonu,
 * nebo appky do PC - vždy jen jeden (lib/homeBanner.ts). Dokud není jasné,
 * jestli je někdo přihlášený, nevykreslí nic - přihlášenému tak nikdy
 * neprobliknou tlačítka „Založit účet“.
 */
export default function HomeTopBanner() {
  // null = ještě nevíme; 'none' = zavřeno křížkem (do příští návštěvy klid).
  const [kind, setKind] = useState<HomeBannerKind | 'none' | null>(null);

  useEffect(() => {
    let alive = true;
    const apply = (signedIn: boolean) => setKind((prev) => (prev === 'none' ? 'none' : decide(signedIn)));

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) apply(!!data.session);
      })
      .catch(() => {
        if (alive) setKind((prev) => prev ?? 'desktop');
      });

    // Přihlášení / odhlášení v jiné kartě: pruh se přepne bez obnovení stránky.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') apply(!!session);
    });

    // Appka se právě nainstalovala (nebo už nejde nabídnout) - pruh pryč.
    const onInstallChange = () =>
      setKind((prev) => (prev === 'install' && (appMarkedInstalled() || !canOfferInstall()) ? 'none' : prev));
    window.addEventListener(INSTALL_READY_EVENT, onInstallChange);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener(INSTALL_READY_EVENT, onInstallChange);
    };
  }, []);

  if (kind === 'guest') {
    return (
      <GuestWelcome
        onDismiss={() => {
          storeNow(GUEST_WELCOME_KEY);
          setKind('none');
        }}
      />
    );
  }
  if (kind === 'install') {
    return (
      <InstallAppBanner
        onDone={() => setKind('none')}
        onDismiss={() => {
          storeNow(INSTALL_BANNER_KEY);
          setKind('none');
        }}
      />
    );
  }
  if (kind === 'desktop') return <DesktopAppBanner />;
  return null;
}
