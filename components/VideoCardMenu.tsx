'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { addToQueue } from '@/lib/videoQueue';
import { hideVideo, hideChannel } from '@/lib/hiddenContent';
import { startDownload, recordDownload } from '@/lib/download';
import ReportModal from './ReportModal';
import {
  PlaylistIcon, WatchLaterIcon, DownloadIcon, ShareIcon, ReportIcon, QueueIcon, NotInterestedIcon, BlockChannelIcon,
} from './ReactionIcons';
import { shareLink, browserShareDeps } from '@/lib/share';
import { panelPosition, PANEL_MAX_HEIGHT, type PanelPos } from '@/lib/menuPosition';

/**
 * Nabídka pod třemi tečkami na kartě videa.
 *
 * Dělá to, co je na YouTube pod ⋮ - přidat do fronty, uložit na později
 * nebo do playlistu, stáhnout, sdílet, schovat z doporučení a nahlásit -
 * takže kvůli žádné z těch věcí není potřeba video otevírat.
 */
/**
 * "Už tam je" není chyba.
 *
 * Ukládá se přes insert, ne upsert: upsert v databázi znamená "když už tam
 * je, přepiš to", což potřebuje zvláštní povolení k úpravě, které tyhle
 * tabulky schválně nemají. Druhé uložení stejného videa tak skončí hláškou
 * o duplicitě (kód 23409/23505) - a to je přesně to, co jsme chtěli.
 */
function isRealError(error: { code?: string } | null): boolean {
  if (!error) return false;
  return error.code !== '23505' && error.code !== '23409';
}

export default function VideoCardMenu({
  video,
  onHide,
  onActivity,
}: {
  video: any;
  /** Ozve se, když si divák video nebo kanál schoval - karta se pak schová. */
  onHide: (what: 'video' | 'channel') => void;
  /** Ozve se, když je nabídka nebo okno "Nahlásit" otevřené. */
  onActivity?: (active: boolean) => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'playlists'>('main');
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Kde nabídka je (pevně k oknu - viz panelPosition). Null = ještě nezměřeno.
  const [pos, setPos] = useState<PanelPos | null>(null);

  const ownerId: string | undefined = video.owner_id ?? video.profiles?.id;

  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [open]);

  // Karta nad sebou drží náhled videa, který běží, dokud je na ní myš.
  // Přes otevřené okno "Nahlásit" myš kartu nikdy neopustí, takže by pod
  // ním video hrálo dál - i se zvukem. Tímhle o tom karta ví.
  useEffect(() => {
    onActivity?.(open || reportOpen);
  }, [open, reportOpen]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      // Nabídka je v <body> (portál), ne v kartě - klik do ní není „mimo“.
      if (wrapRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      closeMenu();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu();
    }
    // Stránka nebo řada karet se posunula - nabídka by visela mimo tečky, tak se zavře.
    // (Posouvání uvnitř nabídky samotné ji nezavře.)
    function handleScroll(e: Event) {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      closeMenu();
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [open]);

  // Poloha nabídky: změří se tečky a nabídka se umístí nad ně, nebo pod ně, kde je víc
  // místa - vždy celá v okně. Dřív visela uvnitř karty a v řadách, které se posouvají
  // do strany (Pokračovat ve sledování, Sparks), ji řada ořízla - horní položky nebyly vidět.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = btnRef.current;
    if (!btn) return;
    const height = panelRef.current?.scrollHeight ?? PANEL_MAX_HEIGHT;
    setPos(panelPosition(btn.getBoundingClientRect(), height, window.innerWidth, window.innerHeight));
  }, [open, view, playlists.length, note, downloadUrl]);

  function closeMenu() {
    setOpen(false);
    setView('main');
    setNote(null);
  }

  /**
   * Klik v nabídce se nesmí propsat do karty pod ní.
   *
   * Schválně jen stopPropagation, žádné preventDefault: nabídka je vedle
   * odkazu na video, ne v něm, takže není co rušit - a preventDefault by
   * zabil odeslání formuláře v okně "Nahlásit", které je uvnitř.
   */
  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  async function requireLogin(): Promise<string | null> {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.push('/login');
      return null;
    }
    return data.user.id;
  }

  function handleQueue(e: React.MouseEvent) {
    stop(e);
    const added = addToQueue({
      id: video.id,
      title: video.title,
      thumbnail_url: video.thumbnail_url ?? null,
      duration_seconds: video.duration_seconds ?? null,
      username: video.profiles?.username ?? null,
      cloudflare_video_id: video.cloudflare_video_id ?? null,
    });
    setNote(added ? t('menuAddedToQueue') : t('menuAlreadyInQueue'));
  }

  async function handleWatchLater(e: React.MouseEvent) {
    stop(e);
    const uid = await requireLogin();
    if (!uid) return;

    const { data: systemPlaylist } = await supabase
      .from('playlists')
      .select('id')
      .eq('owner_id', uid)
      .eq('is_system', true)
      .maybeSingle();

    if (!systemPlaylist) {
      setNote(t('menuActionFailed'));
      return;
    }

    const { error } = await supabase
      .from('playlist_videos')
      .insert({ playlist_id: systemPlaylist.id, video_id: video.id });
    setNote(isRealError(error) ? t('menuActionFailed') : t('menuSavedToWatchLater'));
  }

  async function openPlaylists(e: React.MouseEvent) {
    stop(e);
    const uid = await requireLogin();
    if (!uid) return;

    const { data } = await supabase
      .from('playlists')
      .select('id, title')
      .eq('owner_id', uid)
      .eq('is_system', false)
      .order('created_at', { ascending: false });

    setPlaylists(data ?? []);
    setView('playlists');
  }

  async function addToPlaylist(e: React.MouseEvent, playlistId: string) {
    stop(e);
    const { error } = await supabase
      .from('playlist_videos')
      .insert({ playlist_id: playlistId, video_id: video.id });
    setView('main');
    setNote(isRealError(error) ? t('menuActionFailed') : t('menuSavedToPlaylist'));
  }

  async function handleShare(e: React.MouseEvent) {
    stop(e);
    const url = `${window.location.origin}/watch/${video.id}`;
    // Telefon: systémové okno sdílení. Počítač: schránka. Zavření okna bez
    // výběru se nehlásí (lib/share.ts).
    const outcome = await shareLink({ url, title: video.title }, browserShareDeps());
    if (outcome === 'copied') setNote(t('menuLinkCopied'));
    else if (outcome === 'failed') setNote(url);
    else if (outcome === 'shared') setOpen(false);
  }

  async function handleDownload(e: React.MouseEvent) {
    stop(e);
    if (!video.cloudflare_video_id) return;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      router.push('/login');
      return;
    }

    setDownloading(true);
    setDownloadUrl(null);
    setNote(t('menuPreparingDownload'));

    // Celý postup je v lib/download.ts, ať se obě místa, odkud se dá
    // stáhnout, chovají stejně. Tady se navíc dřív vůbec nezapisovalo do
    // historie stažení - kdo stahoval jen přes tuhle nabídku, měl stránku
    // "Stažené" trvale prázdnou.
    const outcome = await startDownload(video.id, video.cloudflare_video_id);
    setDownloading(false);

    switch (outcome.kind) {
      case 'opened':
        setNote(null);
        closeMenu();
        return;
      case 'link':
        setDownloadUrl(outcome.url);
        setNote(null);
        return;
      case 'needs-login':
        router.push('/login');
        return;
      case 'not-ready':
        setNote(t('menuDownloadNotReady'));
        return;
      case 'failed':
        setNote(t('menuActionFailed'));
        return;
    }
  }

  async function handleNotInterested(e: React.MouseEvent) {
    stop(e);
    const uid = await requireLogin();
    if (!uid) return;

    const { error } = await hideVideo(uid, video.id);
    if (error) {
      setNote(t('menuActionFailed'));
      return;
    }
    closeMenu();
    onHide('video');
  }

  async function handleBlockChannel(e: React.MouseEvent) {
    stop(e);
    if (!ownerId) return;
    const uid = await requireLogin();
    if (!uid) return;

    const { error } = await hideChannel(uid, ownerId);
    if (error) {
      setNote(t('menuActionFailed'));
      return;
    }
    closeMenu();
    onHide('channel');
  }

  return (
    <div className="video-card-menu" ref={wrapRef} onClick={stop}>
      <button
        ref={btnRef}
        type="button"
        className={open ? 'video-card-menu-btn open' : 'video-card-menu-btn'}
        aria-expanded={open}
        aria-label={t('menuMoreActions')}
        title={t('menuMoreActions')}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
          setView('main');
          setNote(null);
        }}
      >
        ⋮
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className="video-card-menu-panel video-card-menu-panel-fixed"
          onClick={stop}
          style={
            pos
              ? { top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, left: pos.left, maxHeight: pos.maxHeight }
              : // První vykreslení: neviditelně, jen kvůli změření výšky.
                { top: 0, left: 0, visibility: 'hidden' }
          }
        >
          {view === 'main' ? (
            <>
              <button type="button" className="video-card-menu-item" onClick={handleQueue}>
                <QueueIcon size={16} /> {t('menuAddToQueue')}
              </button>
              <button type="button" className="video-card-menu-item" onClick={handleWatchLater}>
                <WatchLaterIcon size={16} /> {t('menuWatchLater')}
              </button>
              <button type="button" className="video-card-menu-item" onClick={openPlaylists}>
                <PlaylistIcon size={16} /> {t('menuSaveToPlaylist')}
              </button>
              {video.cloudflare_video_id && !downloadUrl && (
                <button type="button" className="video-card-menu-item" onClick={handleDownload} disabled={downloading}>
                  <DownloadIcon size={16} /> {t('menuDownload')}
                </button>
              )}
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="video-card-menu-item"
                  onClick={() => { recordDownload(video.id); setDownloadUrl(null); closeMenu(); }}
                  style={{ color: 'var(--brand)' }}
                >
                  <DownloadIcon size={16} /> {t('menuDownloadReady')}
                </a>
              )}
              <button type="button" className="video-card-menu-item" onClick={handleShare}>
                <ShareIcon size={16} /> {t('menuShare')}
              </button>

              <div className="video-card-menu-divider" />

              <button type="button" className="video-card-menu-item" onClick={handleNotInterested}>
                <NotInterestedIcon size={16} /> {t('menuNotInterested')}
              </button>
              {ownerId && (
                <button type="button" className="video-card-menu-item" onClick={handleBlockChannel}>
                  <BlockChannelIcon size={16} /> {t('menuDontRecommendChannel')}
                </button>
              )}
              <button
                type="button"
                className="video-card-menu-item"
                onClick={(e) => { stop(e); setReportOpen(true); closeMenu(); }}
              >
                <ReportIcon size={16} /> {t('menuReport')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="video-card-menu-item"
                onClick={(e) => { stop(e); setView('main'); }}
              >
                {t('backButton')}
              </button>
              <div className="video-card-menu-divider" />
              {playlists.length === 0 ? (
                <p className="video-card-menu-note">{t('noPlaylistYetShort')}</p>
              ) : (
                playlists.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="video-card-menu-item"
                    onClick={(e) => addToPlaylist(e, p.id)}
                  >
                    <PlaylistIcon size={16} /> {p.title}
                  </button>
                ))
              )}
            </>
          )}

          {note && <p className="video-card-menu-note">{note}</p>}
        </div>,
        document.body
      )}

      {reportOpen && <ReportModal videoId={video.id} onClose={() => setReportOpen(false)} />}
    </div>
  );
}
