/**
 * Sdílení odkazu.
 *
 * Na telefonu a tabletu se otevře systémové okno (Zprávy, WhatsApp,
 * AirDrop, ...), tak jak to dělá každá nativní appka - kopírování do
 * schránky tam je přesně ten moment, kdy člověk pozná, že je "jen na
 * webu". Na počítači zůstává kopírování: systémové okno tam bývá
 * nečekané a YouTube na počítači taky jen kopíruje.
 *
 * Logika je oddělená od prohlížeče (ShareDeps), aby se dala otestovat
 * bez něj: tests/share.test.mjs.
 */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareData {
  url: string;
  title?: string;
  text?: string;
}

export interface ShareDeps {
  /** Systémové sdílení je dostupné a dává tu smysl (dotykové zařízení). */
  nativeAvailable: boolean;
  share?: (data: ShareData) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}

/**
 * Zkusí systémové sdílení, jinak zkopíruje odkaz.
 *
 * Když člověk systémové okno zavře bez výběru (AbortError), nic se
 * nekopíruje a nic se nehlásí - zavřít okno není chyba a hláška "odkaz
 * zkopírován" by po zavření zmátla. Jiná chyba sdílení spadne na schránku.
 */
export async function shareLink(data: ShareData, deps: ShareDeps): Promise<ShareOutcome> {
  if (deps.nativeAvailable && deps.share) {
    try {
      await deps.share(data);
      return 'shared';
    } catch (err: any) {
      if (err && (err.name === 'AbortError' || err.code === 20)) return 'cancelled';
      // spadne na kopírování
    }
  }

  if (deps.copy) {
    try {
      await deps.copy(data.url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  return 'failed';
}

/** Skutečné závislosti z prohlížeče. */
export function browserShareDeps(): ShareDeps {
  if (typeof navigator === 'undefined') return { nativeAvailable: false };

  const coarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  const nav = navigator as any;

  return {
    nativeAvailable: coarse && typeof nav.share === 'function',
    share: typeof nav.share === 'function' ? (d) => nav.share(d) : undefined,
    copy: nav.clipboard?.writeText ? (t) => nav.clipboard.writeText(t) : undefined,
  };
}
