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
};

type UploadCommands = {
  start: (job: UploadJob) => void;
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
};

const StateContext = createContext<UploadState>(EMPTY);
const CommandsContext = createContext<UploadCommands>({ start: () => {}, dismiss: () => {} });

export function useUploadState() {
  return useContext(StateContext);
}

export function useUploadCommands() {
  return useContext(CommandsContext);
}

/** Čeká, až Cloudflare video zpracuje. Vrací, jestli se to stihlo. */
async function waitUntilReady(videoId: string, token: string | undefined): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
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
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UploadState>(EMPTY);
  const busyRef = useRef(false);

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

  const start = useCallback(
    (job: UploadJob) => {
      // Dvě nahrávání naráz nedávají smysl a hlavně by si přepsala stav.
      if (busyRef.current) return;
      busyRef.current = true;

      setState({
        phase: 'uploading',
        percent: 0,
        title: job.title,
        videoId: null,
        error: null,
        failedInvites: null,
        busy: true,
      });

      void run(job);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function run(job: UploadJob) {
    try {
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
      await waitUntilReady(newVideoId, token);

      busyRef.current = false;
      uprav({
        phase: 'done',
        busy: false,
        failedInvites: failed.length > 0 ? { videoId: newVideoId, names: failed } : null,
      });
    } catch (err: any) {
      busyRef.current = false;
      uprav({ phase: 'error', busy: false, error: err?.message ?? 'Nahrávání se nepovedlo.' });
    }
  }

  const dismiss = useCallback(() => {
    if (busyRef.current) return;
    setState(EMPTY);
  }, []);

  const commands = useMemo<UploadCommands>(() => ({ start, dismiss }), [start, dismiss]);

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
