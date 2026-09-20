'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { uploadResumable } from './tusUpload';

/**
 * Nahrávání, které přežije odchod ze stránky.
 *
 * Dřív celé nahrávání bydlelo ve stránce /upload. Jakmile tvůrce odešel
 * jinam, Next.js stránku odpojil, běžící požadavek se zrušil a nahrávání
 * bylo pryč - u dvanáctiminutového videa to znamená sedět u jedné
 * stránky klidně čtvrt hodiny a nedělat nic.
 *
 * Je to ta samá potíž a to samé řešení jako u hudby: co má přežít
 * navigaci, nesmí bydlet ve stránce, ale v kostře appky. Stránka jen
 * posbírá, co má tvůrce vyplněné, a předá to sem; odsud běží celý zbytek
 * (nahrání souboru, uložení videa, náhled, playlisty, pozvánky ke
 * spolupráci, čekání na zpracování) bez ohledu na to, kde tvůrce zrovna
 * je.
 *
 * Co tím nezískáme: obnovení stránky nebo zavření karty nahrávání pořád
 * ukončí - prohlížeč po obnovení už nemá vybraný soubor a znovu si ho
 * vzít nemůže. Na to appka aspoň upozorní (viz beforeunload níž).
 *
 * FRONTA (hromadné nahrání, přenos kanálu)
 *
 * Tvůrce, který si sem přenáší kanál, nenahraje 60 videí po jednom. Proto
 * se sem dá poslat víc úloh naráz: běží jedna po druhé (souběžně by si
 * jen braly pásmo a Cloudflare by je stejně řadil), proužek dole ukazuje
 * "3/12" a na konci odkaz na Moje videa. Rozměry videa si úloha dopočítá
 * sama, když je nedostala (u hromadného výběru se nikde nepřehrávají).
 */

export type UploadJob = {
  file: File;
  thumbnailFile: File | null;
  title: string;
  description: string;
  hashtags: string[];
  madeForKids: boolean;
  hasPaidPromotion: boolean;
  isAiGenerated: boolean;
  language: string;
  category: string;
  visibility: string;
  isPremiere: boolean;
  scheduledAt: string | null;
  width: number | null;
  height: number | null;
  chapters: { time: number; title: string }[];
  captions: { time: number; text: string }[];
  playlistIds: string[];
  collaborators: { id: string; username: string }[];
  /** Text oznámení pro spolutvůrce - překlad zná stránka, ne tenhle soubor. */
  collabInviteMessage: string;
};

export type UploadPhase = 'idle' | 'uploading' | 'saving' | 'processing' | 'done' | 'error';

export type UploadState = {
  phase: UploadPhase;
  /** 0-100, jen ve fázi nahrávání souboru. */
  percent: number;
  title: string;
  videoId: string | null;
  error: string | null;
  /** Video je nahrané, ale některé pozvánky ke spolupráci neprošly. */
  failedInvites: { videoId: string; names: string[] } | null;
  /** Běží nahrávání? Podle toho se hlídá zavření karty i druhý pokus. */
  busy: boolean;
  /** Fronta: kolik úloh čeká za tou, co běží. */
  queued: number;
  /** Fronta: kolik úloh z dávky je hotových (i s chybou) a kolik jich celkem bylo. */
  batchDone: number;
  batchTotal: number;
  batchFailed: number;
};

type UploadCommands = {
  /** Zařadí úlohu; když nic neběží, rozjede se hned, jinak počká ve frontě. */
  start: (job: UploadJob) => void;
  /** Zařadí víc úloh naráz (hromadné nahrání). */
  startMany: (jobs: UploadJob[]) => void;
  /** Uklidí hlášku po dokončení nebo po chybě. */
  dismiss: () => void;
};

const EMPTY: UploadState = {
  phase: 'idle',
  percent: 0,
  title: '',
  videoId: null,
  error: null,
  failedInvites: null,
  busy: false,
  queued: 0,
  batchDone: 0,
  batchTotal: 0,
  batchFailed: 0,
};

const StateContext = createContext<UploadState>(EMPTY);
const CommandsContext = createContext<UploadCommands>({ start: () => {}, startMany: () => {}, dismiss: () => {} });

/**
 * Rozměry videa ze souboru - jen v prohlížeči, přes skrytý <video>.
 * Když se to do pár vteřin nepovede (exotický formát), vrátí null a
 * rozměry doplní Cloudflare po zpracování (lib/markVideoReady.ts).
 */
function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (value: { width: number; height: number } | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 5000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null);
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    video.src = url;
  });
}

export function useUploadState() {
  return useContext(StateContext);
}

export function useUploadCommands() {
  return useContext(CommandsContext);
}

/**
 * Jak dlouho čekat mezi dotazy na stav, v milisekundách.
 *
 * Dřív to bylo čtyřicetkrát po třech vteřinách, tedy dvě minuty - a pak
 * konec. Dvanáctiminutové video Cloudflare za dvě minuty nezpracuje,
 * takže se video nikdy nepřepnulo na "hotové" a na Kine se neobjevilo,
 * přestože na Cloudflare bylo v pořádku.
 *
 * Zhusta na začátku (krátká videa jsou hotová za pár vteřin), pak čím
 * dál řidčeji, dohromady asi tři čtvrtě hodiny. Nic to nezdržuje - běží
 * to na pozadí.
 */
function rozvrhDotazu(): number[] {
  const kroky: number[] = [];
  for (let i = 0; i < 20; i++) kroky.push(3000); // první minuta
  for (let i = 0; i < 18; i++) kroky.push(10000); // do čtvrté minuty
  for (let i = 0; i < 80; i++) kroky.push(30000); // dál až do ~45 minut
  return kroky;
}

/** Čeká, až Cloudflare video zpracuje. Vrací, jestli se to stihlo. */
async function waitUntilReady(videoId: string, token: string | undefined): Promise<boolean> {
  for (const pauza of rozvrhDotazu()) {
    try {
      const res = await fetch('/api/videos/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (data.status === 'ready') return true;
    } catch {
      // Výpadek při dotazu na stav není důvod hlásit chybu - video už je
      // nahrané a zpracovává se dál i bez nás.
    }
    await new Promise((resolve) => setTimeout(resolve, pauza));
  }
  return false;
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UploadState>(EMPTY);
  const busyRef = useRef(false);
  const queueRef = useRef<UploadJob[]>([]);
  // Dávka: počítadla pro proužek ("3/12"). Nulují se, když fronta doběhne
  // a tvůrce hlášku zavře.
  const batchRef = useRef({ done: 0, total: 0, failed: 0 });

  const uprav = useCallback((zmena: Partial<UploadState>) => {
    setState((prev) => ({ ...prev, ...zmena }));
  }, []);

  /**
   * Zavření karty nebo obnovení stránky nahrávání ukončí - prohlížeč po
   * obnovení už vybraný soubor nemá. Aspoň se na to zeptá.
   */
  useEffect(() => {
    if (!state.busy) return;

    function varuj(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Text si dnešní prohlížeče stejně nastaví samy, ale bez přiřazení
      // se okno neukáže.
      e.returnValue = '';
    }

    window.addEventListener('beforeunload', varuj);
    return () => window.removeEventListener('beforeunload', varuj);
  }, [state.busy]);

  function beginJob(job: UploadJob) {
    busyRef.current = true;
    const batch = batchRef.current;
    setState((prev) => ({
      ...prev,
      phase: 'uploading',
      percent: 0,
      title: job.title,
      videoId: null,
      error: null,
      failedInvites: null,
      busy: true,
      queued: queueRef.current.length,
      batchDone: batch.done,
      batchTotal: batch.total,
      batchFailed: batch.failed,
    }));
    void run(job);
  }

  /** Po doběhnutí úlohy pustí další z fronty, nebo ohlásí konec dávky. */
  function finishJob(outcome: 'done' | 'error', patch: Partial<UploadState>) {
    const batch = batchRef.current;
    batch.done += 1;
    if (outcome === 'error') batch.failed += 1;

    const next = queueRef.current.shift();
    if (next) {
      // Průběžné hlášení jen na okamžik - hned se rozjede další úloha.
      uprav({ ...patch, batchDone: batch.done, batchFailed: batch.failed, queued: queueRef.current.length });
      beginJob(next);
      return;
    }

    busyRef.current = false;
    uprav({ ...patch, phase: outcome, busy: false, queued: 0, batchDone: batch.done, batchTotal: batch.total, batchFailed: batch.failed });
  }

  const start = useCallback(
    (job: UploadJob) => {
      if (busyRef.current) {
        queueRef.current.push(job);
        batchRef.current.total += 1;
        uprav({ queued: queueRef.current.length, batchTotal: batchRef.current.total });
        return;
      }
      // Nic neběží = nová dávka (i když je dole ještě hláška z té minulé).
      batchRef.current = { done: 0, total: 1, failed: 0 };
      beginJob(job);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const startMany = useCallback(
    (jobs: UploadJob[]) => {
      for (const job of jobs) start(job);
    },
    [start]
  );

  async function run(job: UploadJob) {
    try {
      // Hromadný výběr rozměry nezná (soubory se nikde nepřehrávají) -
      // dopočítají se tady, ať Sparks poznají svislé video hned.
      if (job.width == null || job.height == null) {
        const dims = await readDimensions(job.file);
        if (dims) {
          job = { ...job, width: dims.width, height: dims.height };
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const urlRes = await fetch('/api/videos/create-upload-url', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSize: job.file.size }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Nepodařilo se připravit upload.');

      if (urlData.mode === 'tus') {
        await uploadResumable({
          url: urlData.uploadURL,
          file: job.file,
          onProgress: (p) => uprav({ percent: p }),
        });
      } else {
        await uploadBasic(urlData.uploadURL, job.file, (p) => uprav({ percent: p }));
      }

      uprav({ phase: 'saving', percent: 100 });

      const confirmRes = await fetch('/api/videos/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: job.title,
          description: job.description,
          cloudflareVideoId: urlData.videoId,
          madeForKids: job.madeForKids,
          hasPaidPromotion: job.hasPaidPromotion,
          isAiGenerated: job.isAiGenerated,
          language: job.language,
          category: job.category,
          visibility: job.visibility,
          isPremiere: job.isPremiere,
          scheduledAt: job.scheduledAt,
          width: job.width,
          height: job.height,
          chapters: job.chapters,
          captions: job.captions,
          hashtags: job.hashtags,
        }),
      });

      if (!confirmRes.ok) {
        const confirmData = await confirmRes.json().catch(() => ({}));
        throw new Error(confirmData.error || 'Nepodařilo se uložit video.');
      }

      const confirmData = await confirmRes.json();
      const newVideoId = confirmData.video.id;
      uprav({ videoId: newVideoId });

      if (job.thumbnailFile) {
        const userId = sessionData.session?.user.id;
        if (userId) {
          const ext = job.thumbnailFile.name.split('.').pop();
          const path = `${userId}/${newVideoId}.${ext}`;
          const { error: thumbError } = await supabase.storage
            .from('thumbnails')
            .upload(path, job.thumbnailFile, { upsert: true });
          if (!thumbError) {
            const { data: publicUrlData } = supabase.storage.from('thumbnails').getPublicUrl(path);
            await supabase
              .from('videos')
              .update({ thumbnail_url: `${publicUrlData.publicUrl}?t=${Date.now()}`, custom_thumbnail: true })
              .eq('id', newVideoId);
          }
        }
      }

      if (job.playlistIds.length > 0) {
        await Promise.all(
          job.playlistIds.map((playlistId) =>
            supabase.from('playlist_videos').upsert({ playlist_id: playlistId, video_id: newVideoId })
          )
        );
      }

      let failed: string[] = [];

      if (job.collaborators.length > 0) {
        await supabase
          .from('videos')
          .update({ pending_collab_visibility: job.visibility })
          .eq('id', newVideoId);

        // Chyby při zvaní se dřív potichu ztratily - tvůrci to vypadalo,
        // že spolupráce prostě "nefunguje". Teď se seberou a ukážou.
        await Promise.all(
          job.collaborators.map(async (c) => {
            const { error: collabError } = await supabase
              .from('video_collaborators')
              .insert({ video_id: newVideoId, profile_id: c.id, status: 'pending' });

            if (collabError) {
              failed.push(c.username);
              return;
            }

            const { error: notifyError } = await supabase.from('notifications').insert({
              user_id: c.id,
              type: 'collab_invite',
              message: job.collabInviteMessage,
              link: `/watch/${newVideoId}`,
            });

            if (notifyError) failed.push(c.username);
          })
        );
      }

      uprav({ phase: 'processing' });
      // Ve frontě se na zpracování nečeká - další soubor má jít nahoru
      // hned. Zpracování hlídá webhook / doptávání v Moje videa.
      if (queueRef.current.length === 0) await waitUntilReady(newVideoId, token);

      finishJob('done', {
        failedInvites: failed.length > 0 ? { videoId: newVideoId, names: failed } : null,
      });
    } catch (err: any) {
      finishJob('error', { error: err?.message ?? 'Nahrávání se nepovedlo.' });
    }
  }

  const dismiss = useCallback(() => {
    if (busyRef.current) return;
    batchRef.current = { done: 0, total: 0, failed: 0 };
    setState(EMPTY);
  }, []);

  const commands = useMemo<UploadCommands>(() => ({ start, startMany, dismiss }), [start, startMany, dismiss]);

  return (
    <CommandsContext.Provider value={commands}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </CommandsContext.Provider>
  );
}

/**
 * Nahrání jedním požadavkem (malé soubory).
 *
 * XMLHttpRequest, a ne fetch, jen kvůli tomu, že umí hlásit průběh
 * odesílání - fetch to dodnes neumí.
 */
function uploadBasic(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload do Cloudflare selhal (kód ${xhr.status}).`));
    };
    // Prohlížeč tu nedokáže rozlišit vypadlé připojení od odmítnutí druhou
    // stranou: odmítnutá odpověď z cizí domény se k nám nedostane a XHR
    // ohlásí obojí stejně.
    xhr.onerror = () =>
      reject(
        new Error(
          `Nahrávání se přerušilo. Buď vypadlo připojení, nebo soubor odmítla druhá strana ` +
            `(velikost ${(file.size / 1024 / 1024).toFixed(0)} MB).`
        )
      );
    xhr.send(formData);
  });
}
