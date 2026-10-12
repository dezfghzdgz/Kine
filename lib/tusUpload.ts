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

/**
 * 20 MiB: první kus (nad minimem 5 MiB, dělitelné 256 KiB). Další kusy se
 * přizpůsobí rychlosti připojení (nextChunkSize) - u rychlého jsou větší.
 */
export const TUS_CHUNK_SIZE = 20 * 1024 * 1024;

/**
 * Velikost kusu podle rychlosti: každý kus čeká na potvrzení od Cloudflare
 * (uložení), takže malé kusy na rychlém připojení zdržují - u dlouhých
 * videí (gigabajty) to bylo znát nejvíc. Cloudflare sám doporučuje kolem
 * 50 MB. Cíl: jeden kus ~8 s (průběh se pořád hýbe), mezi 8 a 64 MiB.
 */
export const TUS_MIN_CHUNK = 8 * 1024 * 1024;
export const TUS_MAX_CHUNK = 64 * 1024 * 1024;
const TUS_TARGET_CHUNK_MS = 8000;
const TUS_QUANTUM = 256 * 1024;

/** Další velikost kusu podle toho, jak rychle odešel ten poslední (nejvýš dvojnásobek / polovina). */
export function nextChunkSize(current: number, bytes: number, ms: number): number {
  if (!(bytes > 0) || !(ms >= 0)) return current;
  if (ms < 500) {
    // Celý kus za míň než půl vteřiny = rychlé připojení: dvojnásobek (měření je
    // na výpočet moc krátké). Malý poslední kus nebo test nic neříká.
    if (bytes < current) return current;
    return Math.min(TUS_MAX_CHUNK, Math.max(TUS_MIN_CHUNK, Math.floor((current * 2) / TUS_QUANTUM) * TUS_QUANTUM));
  }
  const ideal = (bytes / ms) * TUS_TARGET_CHUNK_MS;
  const next = Math.min(current * 2, Math.max(current / 2, ideal));
  const clamped = Math.min(TUS_MAX_CHUNK, Math.max(TUS_MIN_CHUNK, next));
  return Math.floor(clamped / TUS_QUANTUM) * TUS_QUANTUM;
}

/** Po výpadku menší kus (nestabilní připojení) - nejméně TUS_MIN_CHUNK. */
export function smallerChunk(current: number): number {
  return Math.max(TUS_MIN_CHUNK, Math.floor(current / 2 / TUS_QUANTUM) * TUS_QUANTUM);
}

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
  /** Pevná velikost kusu (testy); bez ní se velikost přizpůsobuje rychlosti připojení. */
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

type KusOdpoved = { ok: boolean; status: number; offset: number | null };

/**
 * Jeden kus přes XMLHttpRequest - na rozdíl od fetch hlásí průběh odesílání,
 * takže proužek se hýbe i během velkého kusu.
 */
function posliKusXhr(url: string, offset: number, kus: Blob, onBytes: (sent: number) => void): Promise<KusOdpoved> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PATCH', url);
    xhr.setRequestHeader('Tus-Resumable', TUS_VERSION);
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      const hlavicka = xhr.getResponseHeader('Upload-Offset');
      const hodnota = hlavicka === null ? NaN : Number(hlavicka);
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, offset: Number.isFinite(hodnota) ? hodnota : null });
    };
    xhr.onerror = () => reject(new Error('Failed to fetch'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.send(kus);
  });
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
  // V prohlížeči XMLHttpRequest (průběh i uvnitř kusu); v testu podstrčený fetch.
  const xhr = !fetchImpl && typeof XMLHttpRequest !== 'undefined';
  const pevny = options.chunkSize !== undefined;
  let velikostKusu = chunkSize;
  const celkem = file.size;
  let offset = 0;
  let pokusy = 0;
  let hlaseno = 0;
  const hlas = (bajty: number) => {
    const procenta = Math.min(100, Math.round((bajty / celkem) * 100));
    // Průběh nikdy necouvá (opakovaný kus začíná znovu od začátku kusu).
    if (procenta > hlaseno) {
      hlaseno = procenta;
      onProgress?.(procenta);
    }
  };

  onProgress?.(0);

  while (offset < celkem) {
    const konec = Math.min(offset + velikostKusu, celkem);
    const kus = file.slice(offset, konec);
    const zacatek = Date.now();

    let odpoved: KusOdpoved | null = null;
    let chyba: unknown = null;

    try {
      if (xhr) {
        const od = offset;
        odpoved = await posliKusXhr(url, offset, kus, (odeslano) => hlas(od + Math.min(odeslano, konec - od) * 0.99));
      } else {
        const res = await doFetch(url, {
          method: 'PATCH',
          headers: {
            'Tus-Resumable': TUS_VERSION,
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: kus,
        });
        const hlavicka = res.headers.get('Upload-Offset');
        const hodnota = hlavicka === null ? NaN : Number(hlavicka);
        odpoved = { ok: res.ok, status: res.status, offset: Number.isFinite(hodnota) ? hodnota : null };
      }
    } catch (e) {
      chyba = e;
    }

    if (odpoved && odpoved.ok) {
      pokusy = 0;
      const odeslano = konec - offset;

      // Přednost má to, co hlásí druhá strana; když to prohlížeč nevidí,
      // pokračuje se podle vlastního počítadla.
      offset = odpoved.offset !== null && odpoved.offset > offset ? odpoved.offset : konec;
      if (!pevny) velikostKusu = nextChunkSize(velikostKusu, odeslano, Date.now() - zacatek);

      hlas(offset);
      continue;
    }

    // Neúspěch. 4xx kromě 409/423 nemá cenu opakovat - odpověď se
    // opakováním nezmění.
    const status = odpoved?.status;
    if (status && status >= 400 && status < 500 && status !== 409 && status !== 423) {
      throw new TusError(`Cloudflare odmítl část souboru (kód ${status}).`, status);
    }

    pokusy++;
    // Nestabilní připojení: další pokusy menšími kusy (míň toho přijde nazmar).
    if (!pevny) velikostKusu = smallerChunk(velikostKusu);
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
