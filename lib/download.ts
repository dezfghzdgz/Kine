import { supabase } from './supabaseClient';

/**
 * Stahování videa - společný postup pro obě místa, odkud se dá stáhnout.
 *
 * Dvě pasti, na kterých to tu selhávalo:
 *
 * 1. Cloudflare soubor ke stažení teprve chystá, takže se ho appka musí
 *    ptát opakovaně. Jenže novou kartu prohlížeč otevře jen krátce po
 *    kliknutí - když se čekalo dvě a půl vteřiny a teprve pak zavolalo
 *    window.open, prohlížeč kartu tiše zablokoval. Uživateli se nestalo
 *    vůbec nic a žádná chyba se neukázala. Proto se karta zkouší otevřít
 *    jen na první pokus a jinak se nabídne odkaz, na který klikne sám.
 *
 * 2. Do historie stažení se zapisovalo hned po získání adresy, tedy i
 *    tehdy, když se pak nic nestáhlo. Tlačítko na kartě (nabídka ⋮) zase
 *    nezapisovalo vůbec, takže stránka "Stažené" zůstala prázdná i po
 *    desátém stažení. Zapisuje se odteď na jednom místě a až ve chvíli,
 *    kdy se soubor opravdu otevřel.
 */

export type DownloadOutcome =
  /** Soubor se otevřel v nové kartě, hotovo. */
  | { kind: 'opened' }
  /** Soubor je připravený, ale kartu si musí otevřít uživatel sám. */
  | { kind: 'link'; url: string }
  /** Cloudflare to nestihl připravit. */
  | { kind: 'not-ready' }
  | { kind: 'needs-login' }
  | { kind: 'failed'; message?: string };

const ATTEMPTS = 20;
const WAIT_MS = 2500;

export async function startDownload(
  videoId: string,
  cloudflareVideoId: string
): Promise<DownloadOutcome> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return { kind: 'needs-login' };

  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const res = await fetch('/api/videos/enable-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ cloudflareVideoId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { kind: 'failed', message: data?.error };

      if (data.status === 'ready' && data.url) {
        if (attempt === 0) {
          const opened = window.open(data.url, '_blank');
          if (opened) {
            await recordDownload(videoId);
            return { kind: 'opened' };
          }
        }
        return { kind: 'link', url: data.url };
      }

      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }

    return { kind: 'not-ready' };
  } catch (err: any) {
    return { kind: 'failed', message: err?.message };
  }
}

/**
 * Zapíše video do historie stažení.
 *
 * Volá se až ve chvíli, kdy se soubor opravdu otevřel - ne dřív.
 * Když zápis selže, stažení tím nepokazíme; jen se to neobjeví v historii.
 */
export async function recordDownload(videoId: string): Promise<void> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return;

  await supabase.from('downloads').upsert(
    {
      user_id: authData.user.id,
      video_id: videoId,
      downloaded_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,video_id' }
  );
}
