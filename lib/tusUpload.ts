/**
 * Nahrávání velkých videí po částech (protokol tus).
 *
 * PROČ TO TU JE
 *
 * Cloudflare přijme jedním obyčejným požadavkem nejvýš 200 MB. Větší
 * soubor odmítne uprostřed nahrávání - a protože odmítnutá odpověď
 * nenese hlavičky pro cizí doménu, prohlížeč z ní nic nepřečte a ohlásí
 * jen "chyba sítě". Appka pak tvrdila, že vypadlo připojení, i když
 * připojení bylo v pořádku a problém byl ve velikosti.
 *
 * Odtud i to podezřelé "vždycky po 20 %": u souboru kolem gigabajtu je
 * 200 MB právě pětina.
 *
 * JAK TO FUNGUJE
 *
 * Soubor se posílá po kusech. Server (naše /api/videos/create-upload-url)
 * si u Cloudflare vyžádá jednorázovou adresu a prohlížeč do ní posílá
 * jeden kus za druhým, každý s údajem, kolik bajtů už je nahraných.
 * Když jeden kus selže, nezačíná se od začátku: appka se zeptá, kolik
 * toho druhá strana má, a pokračuje odtamtud. Přerušené nahrávání na
 * mobilu tedy nemusí znamenat začínat znovu.
 *
 * Velikost kusu má od Cloudflare dvě podmínky: nejméně 5 MiB a musí být
 * dělitelná 256 KiB.
 */

/** 20 MiB: nad minimem 5 MiB, dělitelné 256 KiB, a dost malé, ať se opakovaný pokus nevleče. */
export const TUS_CHUNK_SIZE = 20 * 1024 * 1024;

/**
 * Od jaké velikosti se posílá po částech.
 *
 * Cloudflare zvládne jedním požadavkem 200 MB; práh je níž schválně, ať
 * je rezerva na to, že multipart obálka soubor o kousek nafoukne.
 */
export const RESUMABLE_FROM_BYTES = 150 * 1024 * 1024;

/**
 * Base64 pro hlavičku Upload-Metadata.
 *
 * Vlastní, protože Buffer je jen v Node a btoa jen v prohlížeči - a
 * tenhle soubor se používá na obou stranách. Vstup jsou vždycky číslice,
 * takže stačí obyčejné ASCII.
 */
export function base64Ascii(text: string): string {
  const abeceda = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let vysledek = '';

  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i);
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) : NaN;

    vysledek += abeceda[a >> 2];
    vysledek += abeceda[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    vysledek += Number.isNaN(b) ? '=' : abeceda[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    vysledek += Number.isNaN(c) ? '=' : abeceda[c & 63];
  }

  return vysledek;
}

export type TusOptions = {
  /** Jednorázová adresa od Cloudflare (hlavička Location při zakládání). */
  url: string;
  file: Blob;
  /** Kolik procent je hotovo, 0-100. */
  onProgress?: (percent: number) => void;
  chunkSize?: number;
  /** Kolikrát zkusit jeden kus znovu, než to appka vzdá. */
  maxRetries?: number;
  /** Jen kvůli testu. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class TusError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TusError';
  }
}

const TUS_VERSION = '1.0.0';

function pockej(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Zjistí, kolik bajtů už druhá strana má.
 *
 * Volá se po neúspěchu: bez toho by se posílal kus, který už tam možná
 * je, a nahrávání by se rozešlo.
 */
async function zjistiOffset(url: string, doFetch: typeof fetch): Promise<number | null> {
  try {
    const res = await doFetch(url, {
      method: 'HEAD',
      headers: { 'Tus-Resumable': TUS_VERSION, 'Cache-Control': 'no-store' },
    });
    if (!res.ok) return null;
    const hlavicka = res.headers.get('Upload-Offset');
    if (hlavicka === null) return null;
    const hodnota = Number(hlavicka);
    return Number.isFinite(hodnota) && hodnota >= 0 ? hodnota : null;
  } catch {
    // Prohlížeč hlavičku vidět nemusí (cizí doména). Pak se pokračuje
    // podle vlastního počítadla - horší varianta, ale ne chyba.
    return null;
  }
}

/**
 * Nahraje soubor po částech. Vrací se, až je nahraný celý.
 *
 * Vyhodí TusError, když se ani po opakovaných pokusech nepovede jeden
 * a ten samý kus.
 */
export async function uploadResumable(options: TusOptions): Promise<void> {
  const {
    url,
    file,
    onProgress,
    chunkSize = TUS_CHUNK_SIZE,
    maxRetries = 5,
    fetchImpl,
    sleep = pockej,
  } = options;

  const doFetch = fetchImpl ?? fetch;
  const celkem = file.size;
  let offset = 0;
  let pokusy = 0;

  onProgress?.(0);

  while (offset < celkem) {
    const konec = Math.min(offset + chunkSize, celkem);
    const kus = file.slice(offset, konec);

    let odpoved: Response | null = null;
    let chyba: unknown = null;

    try {
      odpoved = await doFetch(url, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': TUS_VERSION,
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
        },
        body: kus,
      });
    } catch (e) {
      chyba = e;
    }

    if (odpoved && odpoved.ok) {
      pokusy = 0;

      // Přednost má to, co hlásí druhá strana; když to prohlížeč nevidí,
      // pokračuje se podle vlastního počítadla.
      const hlaseny = Number(odpoved.headers.get('Upload-Offset'));
      offset = Number.isFinite(hlaseny) && hlaseny > offset ? hlaseny : konec;

      onProgress?.(Math.min(100, Math.round((offset / celkem) * 100)));
      continue;
    }

    // Neúspěch. 4xx kromě 409/423 nemá cenu opakovat - odpověď se
    // opakováním nezmění.
    const status = odpoved?.status;
    if (status && status >= 400 && status < 500 && status !== 409 && status !== 423) {
      throw new TusError(`Cloudflare odmítl část souboru (kód ${status}).`, status);
    }

    pokusy++;
    if (pokusy > maxRetries) {
      throw new TusError(
        chyba instanceof Error
          ? `Nahrávání se přerušilo: ${chyba.message}`
          : `Nahrávání se přerušilo (kód ${status ?? '—'}).`,
        status
      );
    }

    // Chvíli počkat a zjistit, kde druhá strana doopravdy je.
    await sleep(Math.min(1000 * 2 ** (pokusy - 1), 8000));
    const skutecny = await zjistiOffset(url, doFetch);
    if (skutecny !== null && skutecny >= 0 && skutecny <= celkem) offset = skutecny;
  }

  onProgress?.(100);
}
