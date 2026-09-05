'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { buildVideoBlocks, isSpark } from '@/lib/videoBlocks';
import { getTotalReactionCount, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';
import { supabase } from '@/lib/supabaseClient';
import { computeTrustRating } from '@/lib/trustRating';
import VideoReactions from '@/components/VideoReactions';
import CommentSection from '@/components/CommentSection';
import AddToPlaylist from '@/components/AddToPlaylist';
import SubscribeButton from '@/components/SubscribeButton';
import DownloadButton from '@/components/DownloadButton';
import WatchHistoryTracker from '@/components/WatchHistoryTracker';
import ChapterTimeline from '@/components/ChapterTimeline';
import CaptionsOverlay from '@/components/CaptionsOverlay';
import ReportModal from '@/components/ReportModal';
import VerifiedBadge from '@/components/VerifiedBadge';
import Toast, { ToastType } from '@/components/Toast';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';
import { useUserRole } from '@/lib/useUserRole';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ShareIcon, WatchLaterIcon, ReportIcon, TrashIcon } from '@/components/ReactionIcons';
import { detectViewSource } from '@/lib/viewSource';
import { getQueue, removeFromQueue, clearQueue, subscribeToQueue, type QueuedVideo } from '@/lib/videoQueue';
import { videoCountLabel } from '@/lib/plural';
import { playbackMode } from '@/lib/playbackMode';
import { buildMusicQueue, trackFromVideo } from '@/lib/musicQueue';
import { useMusicCommands } from '@/lib/musicPlayer';
import MusicStage from '@/components/MusicStage';
import MusicVideoSurface from '@/components/MusicVideoSurface';
import { startPlayback as beginPlayback } from '@/lib/playerStart';
import { decideOrientationFullscreen } from '@/lib/playerControls';
import { shareLink, browserShareDeps } from '@/lib/share';
import { isTvMode } from '@/lib/tvMode';
import { detectDeviceClass } from '@/lib/deviceClass';
import { fetchAllRows, fetchByIds } from '@/lib/loadAll';
import VideoCard from '@/components/VideoCard';
import { formatDuration } from '@/lib/homeRecommendation';
import { decideMiniPlayer, digitSeekTarget } from '@/lib/miniPlayer';
import { resolvePlaybackId } from '@/lib/playbackToken';

const MUSIC_VIEW_KEY = 'kine-music-view';

function formatChapterTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function WatchPageInner() {
  const { t, lang } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const videoId = params.id as string;
  const [video, setVideo] = useState<any>(null);
  const [otherVideos, setOtherVideos] = useState<any[]>([]);
  const [showUpNext, setShowUpNext] = useState(false);
  const [upNextCountdown, setUpNextCountdown] = useState(8);
  const [trustRating, setTrustRating] = useState<number | null>(null);
  const [collaborators, setCollaborators] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [notFoundDetail, setNotFoundDetail] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [inWatchLater, setInWatchLater] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  // Přehrávač se nerozjel a je potřeba do něj kliknout. Bez tohohle
  // zůstal černý obdélník bez ovládání a nedalo se s ním nic dělat.
  const [needsPlayTap, setNeedsPlayTap] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [showAiBadge, setShowAiBadge] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  // Fallback jen pro prohlížeče, které neumí Fullscreen API na obyčejném
  // prvku (hlavně iPhone Safari) - tam appka zůstane u CSS "na celou plochu".
  const [cssFullscreen, setCssFullscreen] = useState(false);
  // Klávesové zkratky se navěšují jen jednou, takže by jim zůstala navždy
  // hodnota z prvního vykreslení. Aktuální stav si proto držíme i v ref,
  // aby klávesa F v náhradním režimu fungovala oběma směry.
  const cssFullscreenRef = useRef(false);
  // Cedulka ke klávesovým zkratkám. Počítadlo je tu proto, aby se při rychlém
  // mačkání (třeba šipky doprava) animace pokaždé rozjela znovu od začátku.
  const [keyHint, setKeyHint] = useState<{ text: string; nonce: number } | null>(null);
  const keyHintNonceRef = useRef(0);
  const keyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playlistScrolledForRef = useRef<string | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmModDelete, setConfirmModDelete] = useState(false);
  const { isModerator } = useUserRole();
  const playlistId = searchParams.get('playlist');
  const [playlistInfo, setPlaylistInfo] = useState<{ title: string } | null>(null);
  const [playlistVideos, setPlaylistVideos] = useState<any[]>([]);
  const [playlistPanelOpen, setPlaylistPanelOpen] = useState(true);
  // Fronta žije v prohlížeči, ne v databázi. Čte se až po vykreslení, ať
  // se serverová a prohlížečová verze stránky neliší.
  const [queue, setQueue] = useState<QueuedVideo[]>([]);

  // Hudba: obal místo videa. Volba se pamatuje, takže kdo jednou přepne
  // na Video, má ho příště rovnou.
  const [musicView, setMusicView] = useState<'cover' | 'video'>('cover');
  const musicCommands = useMusicCommands();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  // Úklid rozjížděcí smyčky. Kdyby zůstala běžet po výměně přehrávače,
  // posílala by povely do něčeho, co už na obrazovce není.
  const playbackCleanupRef = useRef<(() => void) | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Mini přehrávač: krabice (dock) zůstává ve stránce a drží místo, rámeček
  // s iframem se z ní odpojí do rohu. Iframe se nesmí přesadit v DOMu -
  // znovu by se načetl a napojení na přehrávač by shořelo (viz hudba).
  const dockRef = useRef<HTMLDivElement>(null);
  const [mini, setMini] = useState<{ height: number } | null>(null);
  const miniDismissedRef = useRef(false);
  // Celou obrazovku zapnulo otočení telefonu (ne divák) - jen tu pak
  // otočení zpátky zase vypne. V ref, ať to přežije přepnutí na další video.
  const autoEnteredRef = useRef(false);
  // Pro klávesu C: handler kláves žije v efektu a viděl by staré video.
  const hasCaptionsRef = useRef(false);
  // Odložené započítání zhlédnutí - viz load().
  const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (viewTimerRef.current) {
        clearTimeout(viewTimerRef.current);
        viewTimerRef.current = null;
      }
    };
  }, [videoId]);

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [videoId]);

  useEffect(() => {
    if (!playlistId) {
      setPlaylistInfo(null);
      setPlaylistVideos([]);
      return;
    }
    (async () => {
      const { data: pl } = await supabase.from('playlists').select('title').eq('id', playlistId).maybeSingle();
      setPlaylistInfo(pl ? { title: pl.title } : null);

      // Po dávkách a po kusech: playlist s pár sty videi dřív rozbil panel
      // úplně - seznam id se posílal v adrese jedním dotazem, ta u ~200
      // položek přerostla a dotaz se neprovedl vůbec. fetchByIds posílá id
      // po dávkách a drží pořadí.
      const items = await fetchAllRows((from, to) =>
        supabase
          .from('playlist_videos')
          .select('video_id, position')
          .eq('playlist_id', playlistId)
          .order('position', { ascending: true })
          .range(from, to)
      );

      const videoIds = items.map((i: any) => i.video_id);
      if (videoIds.length === 0) return;

      const ordered = await fetchByIds<any>(
        'videos',
        'id, title, thumbnail_url, duration_seconds, profiles!videos_owner_id_fkey(username)',
        videoIds
      );
      setPlaylistVideos(ordered);
    })().catch(() => {
      // Panel se raději neukáže vůbec, než poloprázdný. Video hraje dál.
      setPlaylistInfo(null);
      setPlaylistVideos([]);
    });
  }, [playlistId]);

  useEffect(() => {
    setShowAiBadge(true);
    const timer = setTimeout(() => setShowAiBadge(false), 10000);
    return () => clearTimeout(timer);
  }, [videoId]);

  // Fronta se drží v prohlížeči, takže se může změnit i na jiné kartě -
  // tímhle se panel překreslí, ať se stane cokoliv.
  useEffect(() => {
    function syncQueue() {
      setQueue(getQueue());
    }
    syncQueue();
    return subscribeToQueue(syncQueue);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MUSIC_VIEW_KEY);
      if (saved === 'cover' || saved === 'video') setMusicView(saved);
    } catch {
      // Zakázaný localStorage - zůstane výchozí obal.
    }
  }, []);

  /**
   * Přepnutí mezi obalem a videem.
   *
   * Odteď je to čistě vizuální věc. Hraje pořád ten samý přehrávač
   * (lib/musicPlayer.tsx) - v režimu Video se jeho obraz jen promítne na
   * stránku, v režimu Obal se schová. Žádné předávání času, žádné druhé
   * načítání, žádná pauza ve zvuku.
   *
   * Dřív si stránka v režimu Video zakládala vlastní přehrávač se stejným
   * videem, jaké hrálo na pozadí. Dva přehrávače téhož videa si ale lezou
   * do zelí: appka se na ten druhý napojila, poslala mu "hraj" a nic se
   * nestalo. Přesně proto se video po přepnutí nikdy nenačetlo.
   */
  function changeMusicView(view: 'cover' | 'video') {
    setMusicView(view);
    try {
      localStorage.setItem(MUSIC_VIEW_KEY, view);
    } catch {
      // Volba se prostě nezapamatuje.
    }
  }

  const mode = playbackMode(video);
  const showMusicStage = mode === 'music' && musicView === 'cover';

  /**
   * Předání skladby trvalému přehrávači.
   *
   * openTrack nic nedělá, když už ta samá skladba hraje - návrat na stránku
   * ji tedy nespustí od začátku. attachStage říká liště dole "velký obal
   * ukazuju já, schovej se".
   */
  useEffect(() => {
    if (!video || !showMusicStage) return;

    const track = trackFromVideo(video);
    if (!track) return;

    let cancelled = false;
    buildMusicQueue(video, otherVideos, queue).then((tracks) => {
      if (!cancelled) musicCommands.openTrack(track, tracks);
    });

    musicCommands.attachStage(video.id);
    return () => {
      cancelled = true;
      musicCommands.attachStage(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, showMusicStage, otherVideos, queue]);

  /**
   * Kdo má zvuk.
   *
   * Dokud je na stránce vidět přehrávač videa, hudba mlčí - a to jako stav,
   * ne jako jednorázový povel. Předtím tu bylo "jakmile bude přehrávač
   * připravený, zastav hudbu", jenže to je jeden okamžik: cokoliv, co
   * skladbu potom zase rozjelo, už nic nezastavilo a hrálo obojí.
   *
   * Platí to i pro obyčejná videa, ne jen pro hudební: když si pustíš video,
   * hudba na pozadí ztichne, stejně jako na YouTube.
   */
  useEffect(() => {
    // Jen u obyčejných videí. U hudby je přehrávač hudby zároveň tím, co
    // je vidět - kdyby se sám umlčel, přepnutí na Video by ho zastavilo.
    musicCommands.setVideoTakeover(!!video && mode !== 'music');
    return () => musicCommands.setVideoTakeover(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, mode]);

  // Klávesové zkratky: mezerník = přehrát/pauza, šipky vlevo/vpravo = posun
  // o 5 s, šipky nahoru/dolů = hlasitost, M = ztlumit, F = celá obrazovka.
  // Ignorujeme je, když uživatel zrovna něco píše (komentář apod.).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || active?.isContentEditable) return;

      // Kombinace s Ctrl/Cmd/Alt patří prohlížeči nebo zkratkám appky
      // (Ctrl+K = hledání), ne přehrávači. Bez tohohle by Ctrl+K vedle
      // otevření hledání ještě zastavil video.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Esc ukončí i náhradní CSS variantu celé obrazovky (u skutečné
      // celé obrazovky si Esc odbaví sám prohlížeč).
      if (e.key === 'Escape') {
        setFallbackFullscreen(false);
      }
      // Přehled zkratek na "?" má components/KeyboardShortcuts.tsx (visí
      // nad celou appkou); na stránce videa v něm jsou i zkratky přehrávače.

      // Režim televize: přehrávač poslouchá klávesy jen když je vybraný -
      // jinak šipky přesouvají výběr po stránce (lib/spatialNav.ts).
      // Nahoru/dolů z něj vedou pryč (hlasitost má ovladač), OK přehrává.
      if (isTvMode()) {
        const inPlayer = !!wrapRef.current?.contains(document.activeElement);
        if (!inPlayer) return;
        if (e.code === 'ArrowUp' || e.code === 'ArrowDown') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          togglePlayPause();
          return;
        }
      }

      const player = playerRef.current;
      if (!player) return;

      if (e.code === 'Space' || e.code === 'KeyK') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekBy(5);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        changeVolume(0.1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        changeVolume(-0.1);
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'KeyJ') {
        // J/L = o 10 s, jako na YouTube; šipky zůstávají na 5 s.
        e.preventDefault();
        seekBy(-10);
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        seekBy(10);
      } else if (e.code === 'KeyC') {
        if (!hasCaptionsRef.current) return;
        e.preventDefault();
        setCaptionsEnabled((v) => !v);
      } else if (/^[0-9]$/.test(e.key)) {
        // 0-9 = skok na desetinu videa (5 = polovina). Podle znaku, ne podle
        // klávesy: na české klávesnici se číslice píšou přes Shift a e.code
        // by řekl "Digit1" i pro "+" - takhle platí, co se opravdu napsalo.
        const target = digitSeekTarget(Number(e.key), player.duration ?? 0);
        if (target === null) return;
        e.preventDefault();
        player.currentTime = target;
        flashHint(formatChapterTime(target));
      }
    }
    // Zachytáváme v "capture" fázi na okně - stihneme to dřív, než se do
    // stisku zapojí cokoliv jiného na stránce.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Přehrávač je cizí iframe (Cloudflare). Jakmile si vezme focus, míří
  // klávesy dovnitř do něj a naše zkratky přestanou úplně fungovat - přesně
  // tenhle stav býval po prvním kliknutí do videa. Focus proto vracíme na
  // rámeček přehrávače, který je díky tabIndex sám o sobě zaměřitelný.
  function stealFocusBackFromIframe() {
    if (document.activeElement === iframeRef.current) {
      wrapRef.current?.focus({ preventScroll: true });
    }
  }

  useEffect(() => {
    // Focus si iframe bere i sám od sebe (třeba když se v něm spustí video),
    // tak na to koukáme i pravidelně, ne jen při kliknutí.
    const interval = setInterval(stealFocusBackFromIframe, 400);
    window.addEventListener('blur', stealFocusBackFromIframe);
    return () => {
      clearInterval(interval);
      window.removeEventListener('blur', stealFocusBackFromIframe);
    };
  }, []);

  // Krátká cedulka uprostřed videa ("+5 s", "Hlasitost 70 %"), ať je po
  // stisku klávesy hned vidět, že se něco stalo.
  function flashHint(text: string) {
    keyHintNonceRef.current += 1;
    setKeyHint({ text, nonce: keyHintNonceRef.current });
    if (keyHintTimerRef.current) clearTimeout(keyHintTimerRef.current);
    keyHintTimerRef.current = setTimeout(() => setKeyHint(null), 900);
  }

  function togglePlayPause() {
    const player = playerRef.current;
    if (!player) return;
    wrapRef.current?.focus({ preventScroll: true });

    // Po dohrání videa mezerník spustí přehrávání znovu od začátku -
    // dřív se s dokoukaným videem nedalo dělat vůbec nic.
    const duration = player.duration ?? video?.duration_seconds ?? 0;
    const atEnd = player.ended || (duration > 0 && (player.currentTime ?? 0) >= duration - 0.3);

    if (atEnd) {
      setShowUpNext(false);
      player.currentTime = 0;
      player.play();
      flashHint(t('playerReplay'));
      return;
    }

    if (player.paused) {
      player.play();
      flashHint('▶');
    } else {
      player.pause();
      flashHint('❚❚');
    }
  }

  function seekBy(seconds: number) {
    const player = playerRef.current;
    if (!player) return;
    const duration = player.duration ?? video?.duration_seconds ?? 0;
    const target = (player.currentTime ?? 0) + seconds;
    player.currentTime = Math.max(0, duration > 0 ? Math.min(target, duration) : target);
    flashHint(seconds > 0 ? `+${seconds} s` : `${seconds} s`);
  }

  function changeVolume(delta: number) {
    const player = playerRef.current;
    if (!player) return;
    const next = Math.max(0, Math.min((player.volume ?? 1) + delta, 1));
    player.volume = next;
    player.muted = next === 0;
    flashHint(t('playerVolume').replace('{percent}', String(Math.round(next * 100))));
  }

  function toggleMute() {
    const player = playerRef.current;
    if (!player) return;
    player.muted = !player.muted;
    flashHint(player.muted ? t('playerMuted') : t('playerUnmuted'));
  }

  // Celá obrazovka řešená přímo prohlížečem (Fullscreen API), ne CSS trikem.
  // Prohlížeč prvek vytáhne do vlastní "horní vrstvy", takže ho nemůže
  // rozhodit ani boční menu, ani horní lišta, ani jakýkoliv rodičovský rámec
  // - přesně jak to funguje na YouTube. Tlačítko Esc / F11 řeší sám prohlížeč.
  // Zapnutí/vypnutí náhradního CSS režimu na jednom místě, ať stav a ref
  // nikdy nerozejdou.
  function setFallbackFullscreen(on: boolean) {
    cssFullscreenRef.current = on;
    setCssFullscreen(on);
    setIsMaximized(on);
  }

  function toggleFullscreen() {
    const el = wrapRef.current as any;
    if (!el) return;

    const doc = document as any;
    const current = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

    if (current) {
      (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
      return;
    }

    // Když už appka jede na náhradní CSS variantě, tohle kliknutí ji vypíná.
    // Bez téhle větve by se z náhradního režimu nedalo vůbec dostat ven.
    if (cssFullscreenRef.current) {
      setFallbackFullscreen(false);
      return;
    }

    const request = el.requestFullscreen ?? el.webkitRequestFullscreen ?? el.msRequestFullscreen;
    if (request) {
      const result = request.call(el);
      // Když prohlížeč požadavek odmítne, appka nespadne do prázdna a
      // aspoň roztáhne přehrávač přes stránku.
      if (result && typeof result.catch === 'function') {
        result.catch(() => setFallbackFullscreen(true));
      }
      return;
    }

    // Prohlížeč Fullscreen API vůbec nemá (starší iOS Safari)
    setFallbackFullscreen(true);
  }

  // Stav si držíme podle prohlížeče, ne podle vlastního klikání - jinak
  // by ikonka zůstala přehozená, když uživatel odejde přes Esc.
  useEffect(() => {
    function syncFullscreenState() {
      const doc = document as any;
      const active = !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
      setIsMaximized(active);
      if (active) {
        cssFullscreenRef.current = false;
        setCssFullscreen(false);
      }
    }
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, []);

  /**
   * Mini přehrávač: když divák odroluje pod video, rámeček se zmenší do
   * rohu a hraje dál. Sleduje se KRABICE (dock), která zůstává ve stránce
   * a drží místo - rámeček sám je v mini režimu pevně v rohu a o jeho
   * viditelnosti by pozorovatel nic neřekl. Rozhodnutí je v
   * lib/miniPlayer.ts (a má test), tady jen měření.
   */
  useEffect(() => {
    setMini(null);
    miniDismissedRef.current = false;
    const dock = dockRef.current;
    if (!dock || mode === 'music' || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const decision = decideMiniPlayer({
          ratio: entry.intersectionRatio,
          top: entry.boundingClientRect.top,
          dismissed: miniDismissedRef.current,
          tv: isTvMode(),
          musicMode: false,
        });
        if (decision.boxVisible) miniDismissedRef.current = false;
        if (!decision.mini) {
          setMini(null);
          return;
        }
        // Výška se změří teď, dokud je rámeček ještě v krabici - po
        // odpojení do rohu by krabice spadla na nulu a stránka poskočila.
        const height = wrapRef.current?.offsetHeight ?? 0;
        setMini((current) => current ?? { height });
      },
      { threshold: [0, 0.15, 0.3, 0.5, 0.75, 1] }
    );
    observer.observe(dock);
    return () => observer.disconnect();
    // video?.id: krabice existuje až po načtení videa, do té doby není co
    // pozorovat - efekt se musí pustit znovu, jakmile se vykreslí.
  }, [videoId, mode, video?.id]);

  function leaveMini(scrollBack: boolean) {
    if (scrollBack) {
      // Zpátky do krabice: krabice se dostane do okna a pozorovatel
      // mini režim sám ukončí.
      dockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Křížek = zavřít: pauza a pryč, dokud divák krabici zase neuvidí.
    playerRef.current?.pause?.();
    miniDismissedRef.current = true;
    setMini(null);
  }

  /**
   * Otočení telefonu na šířku = celá obrazovka, zpátky na výšku = zpátky
   * do stránky. Jako YouTube.
   *
   * Jen telefon (dotyk + nízká obrazovka na šířku); iPad na šířku je
   * normální rozložení. Prohlížeč skutečnou celou obrazovku bez klepnutí
   * nepovolí, takže tady vždycky skončí náhradní CSS varianta - přes celý
   * viditelný displej, což je přesně to, co člověk otočením chtěl.
   * Rozhodování je v lib/playerControls.ts (decideOrientationFullscreen).
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const phoneLandscape = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');

    function onOrientation() {
      // U hudby stránka vlastní přehrávač nemá (rámeček se nevykresluje).
      if (!wrapRef.current) return;

      const doc = document as any;
      const isFullscreen = !!(doc.fullscreenElement ?? doc.webkitFullscreenElement) || cssFullscreenRef.current;
      const decision = decideOrientationFullscreen({
        landscapePhone: phoneLandscape.matches,
        isFullscreen,
        autoEntered: autoEnteredRef.current,
      });

      if (decision === 'enter') {
        setFallbackFullscreen(true);
        autoEnteredRef.current = true;
      } else if (decision === 'exit') {
        setFallbackFullscreen(false);
        autoEnteredRef.current = false;
      }
    }

    // I hned po načtení: kdo otevře video s telefonem už otočeným na šířku,
    // žádnou změnu orientace nevyvolá - a zůstal by v rozložení pro PC
    // s bočním menu vedle videa. (Rámeček existuje až s načteným videem,
    // proto závislost na video?.id.)
    onOrientation();

    phoneLandscape.addEventListener('change', onOrientation);
    return () => phoneLandscape.removeEventListener('change', onOrientation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, mode]);

  /**
   * Náhradní celá obrazovka schová všechno ostatní. Rámeček je sice
   * position: fixed přes celé okno, ale na iPhonu na šířku přes něj
   * zůstalo vidět boční menu (sticky, vlastní vrstva). Třída na <body>
   * nechá zmizet menu, horní lištu, spodní navigaci i lištu hudby -
   * zůstane jen video, tak jak má celá obrazovka vypadat.
   */
  useEffect(() => {
    document.body.classList.toggle('player-css-fullscreen', cssFullscreen);
    return () => document.body.classList.remove('player-css-fullscreen');
  }, [cssFullscreen]);

  /**
   * Spustí přehrávání a nevzdá to.
   *
   * Vlastní postup je v lib/playerStart.ts - je to tam schválně zvlášť,
   * aby se dal otestovat bez prohlížeče (tests/playerStart.test.mjs).
   * Tady zůstává jen napojení na stránku.
   */
  function startPlayback(player: any, seekTo?: number | null) {
    playbackCleanupRef.current?.();
    playbackCleanupRef.current = beginPlayback({
      player,
      seekTo,
      isCurrent: () => playerRef.current === player,
      onStarted: () => setNeedsPlayTap(false),
      onNeedsTap: () => setNeedsPlayTap(true),
    });
  }

  function handlePlayerSdkReady() {
    if (iframeRef.current && (window as any).Stream) {
      playerRef.current = (window as any).Stream(iframeRef.current);
      playerRef.current.muted = false;
      playerRef.current.volume = 1;
      setPlayerReady(true);
      // Na televizi je po otevření vybraný přehrávač: OK hraje, šipky
      // posouvají, dolů vede k názvu a komentářům.
      if (isTvMode()) wrapRef.current?.focus({ preventScroll: true });

      // Tenhle přehrávač je odteď jen pro obyčejná videa. Hudbu hraje
      // jeden jediný přehrávač v kostře appky a stránka si ho jen
      // promítne - viz components/MusicVideoSurface.tsx.
      const t = searchParams.get('t');
      if (t) {
        const seconds = Number(t);
        startPlayback(playerRef.current, Number.isNaN(seconds) ? null : seconds);
      } else {
        // Bez odkazu na konkrétní okamžik naváže appka tam, kde divák
        // naposledy skončil - klidně i z jiného zařízení, protože pozice
        // se ukládá do databáze, ne jen do prohlížeče.
        startPlayback(playerRef.current);
        resumeFromSavedProgress();
      }
    }
  }

  async function resumeFromSavedProgress() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    const { data: history } = await supabase
      .from('watch_history')
      .select('progress_seconds, completed')
      .eq('user_id', authData.user.id)
      .eq('video_id', videoId)
      .single();

    if (
      history?.progress_seconds &&
      !history.completed &&
      history.progress_seconds > 10
    ) {
      setTimeout(() => {
        if (playerRef.current) {
          playerRef.current.currentTime = history.progress_seconds;
          playerRef.current.play();
          const mm = Math.floor(history.progress_seconds / 60);
          const ss = String(history.progress_seconds % 60).padStart(2, '0');
          setToast({ message: t('resumingFromLabel').replace('{time}', `${mm}:${ss}`), type: 'success' });
        }
      }, 300);
    }
  }

  // Uloží, kde divák ve videu skončil, aby se dalo navázat i z jiného
  // zařízení - jednou za 8 sekund, ne při každém snímku, ať to zbytečně
  // nezavaluje databázi.
  useEffect(() => {
    if (!playerReady) return;
    const interval = setInterval(async () => {
      const player = playerRef.current;
      if (!player || !video?.id) return;

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const currentTime = Math.floor(player.currentTime ?? 0);
      const duration = video.duration_seconds ?? 0;
      const completed = duration > 0 && currentTime >= duration - 5;

      await supabase.from('watch_history').upsert(
        {
          user_id: authData.user.id,
          video_id: video.id,
          progress_seconds: currentTime,
          completed,
          watched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,video_id' }
      );
    }, 8000);

    return () => clearInterval(interval);
  }, [playerReady, video?.id]);

  /**
   * Napojení na přehrávač stránky.
   *
   * Zkouší se opakovaně, ne jen jednou - kdy přesně doběhne načtení skriptu
   * Cloudflare se předem neví.
   *
   * Hlídá se i přepnutí obal/video, ne jen změna videa. V režimu obalu žádný
   * přehrávač stránky není, takže by smyčka běžela naprázdno pořád dokola,
   * a hlavně: po prvním přepnutí na video se smyčka sama ukončí, takže při
   * druhém přepnutí by už nebylo co napojit a přehrávač by zůstal mrtvý.
   */
  useEffect(() => {
    playbackCleanupRef.current?.();
    playbackCleanupRef.current = null;
    playerRef.current = null;
    setPlayerReady(false);
    setNeedsPlayTap(false);
    setShowUpNext(false);

    // U hudby stránka žádný vlastní přehrávač nemá - hraje ten v kostře
    // appky a stránka si ho jen promítne.
    if (mode === 'music') return;

    const interval = setInterval(() => {
      if (iframeRef.current && (window as any).Stream && !playerRef.current) {
        handlePlayerSdkReady();
        clearInterval(interval);
      }
    }, 150);

    return () => {
      clearInterval(interval);
      playbackCleanupRef.current?.();
      playbackCleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, mode]);

  const playlistIndex = playlistVideos.findIndex((v) => v.id === videoId);
  const playlistNext = playlistIndex >= 0 ? playlistVideos[playlistIndex + 1] : null;

  // Fronta má přednost před vším ostatním - když si někdo video schválně
  // zařadil "na řadu", má hrát dřív než playlist i doporučená videa.
  const queueIndex = queue.findIndex((v) => v.id === videoId);
  const queueNext = queueIndex >= 0 ? queue[queueIndex + 1] ?? null : queue[0] ?? null;
  const upNextQueue = [
    ...(queueNext ? [queueNext] : []),
    ...(playlistNext ? [playlistNext] : []),
    ...otherVideos,
  ].slice(0, 2);

  function nextHref(id: string) {
    return playlistId ? `/watch/${id}?playlist=${playlistId}` : `/watch/${id}`;
  }

  // U dlouhého playlistu se seznam sám odroluje na video, které zrovna běží,
  // ať ho uživatel nemusí hledat. Jen jednou na video - jinak by seznam
  // uživateli skákal zpátky pokaždé, když se stránka překreslí.
  function scrollCurrentIntoView(el: HTMLAnchorElement | null) {
    if (!el || playlistScrolledForRef.current === videoId) return;
    const list = el.parentElement;
    if (!list) return;

    playlistScrolledForRef.current = videoId;
    // el.offsetTop je vůči seznamu (ten je position: relative), takže se
    // od něj nic dalšího odečítat nesmí.
    list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2);
  }

  // Po dohrání videa nabídneme další doporučené (nebo další video z
  // playlistu, pokud appku sledujete v playlistu), s automatickým odpočtem
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;
    const player = playerRef.current;

    function handleEnded() {
      if (upNextQueue.length > 0) {
        setShowUpNext(true);
        setUpNextCountdown(8);
      }
    }
    player.addEventListener?.('ended', handleEnded);
    return () => player.removeEventListener?.('ended', handleEnded);
  }, [playerReady, upNextQueue]);

  useEffect(() => {
    if (!showUpNext) return;
    if (upNextCountdown <= 0) {
      router.push(nextHref(upNextQueue[0].id));
      return;
    }
    const timer = setTimeout(() => setUpNextCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [showUpNext, upNextCountdown]);

  function seekTo(seconds: number) {
    if (playerRef.current) {
      playerRef.current.currentTime = seconds;
      playerRef.current.play();
    }
  }

  async function load() {
    setLoading(true);
    setNotFound(false);

    const { data, error } = await supabase
      .from('videos')
      .select('*, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, created_at, verification_tier)')
      .eq('id', videoId)
      .single();

    if (error || !data) {
      console.error('Kine: video se nepodařilo načíst', { videoId, error });
      setNotFoundDetail(error?.message ?? 'žádná data');
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Neveřejné video hraje přes podepsaný token, ne přes holé id
    // (lib/playbackToken.ts). Zjistí se DŘÍV, než se přehrávač vykreslí -
    // změna adresy iframu by ho načetla znovu a napojení by shořelo.
    // U veřejného videa je to id samo, bez dotazu.
    data.playback_id = await resolvePlaybackId(data);

    setVideo(data);
    document.title = `${data.title} - Kine`;

    // Appka teď tyhle tři nezávislé věci natahuje souběžně, ne jednu po druhé.
    const [{ data: collabData }, { data: others }, watchLaterResult] = await Promise.all([
      supabase
        .from('video_collaborators')
        .select('profiles(id, username, avatar_url)')
        .eq('video_id', videoId)
        .eq('status', 'accepted'),
      supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, category, owner_id, cloudflare_video_id, profiles!videos_owner_id_fkey(username)')
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .neq('id', videoId)
        .order('created_at', { ascending: false })
        .limit(48),
      (async () => {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user) return { inWatchLater: false };
        const { data: systemPlaylist } = await supabase
          .from('playlists')
          .select('id')
          .eq('owner_id', authData.user.id)
          .eq('is_system', true)
          .maybeSingle();
        if (!systemPlaylist) return { inWatchLater: false };
        const { data: wl } = await supabase
          .from('playlist_videos')
          .select('video_id')
          .eq('playlist_id', systemPlaylist.id)
          .eq('video_id', videoId)
          .maybeSingle();
        return { inWatchLater: !!wl };
      })(),
    ]);

    setCollaborators((collabData ?? []).map((c: any) => c.profiles).filter(Boolean));
    setInWatchLater(watchLaterResult.inWatchLater);

    const currentIsSpark = isSpark(data);
    const matchingFormat = (others ?? []).filter((v: any) => isSpark(v) === currentIsSpark);
    setOtherVideos(matchingFormat.slice(0, 24));

    // Ochrana proti umělému nahánění zhlédnutí:
    // 1) počítáme až po pár vteřinách skutečného sledování, ne hned při otevření stránky
    // 2) stejné video se stejnému prohlížeči nepočítá vícekrát během krátké doby
    const lastViewKey = `kine-viewed-${videoId}`;
    const lastViewedAt = Number(localStorage.getItem(lastViewKey) ?? 0);
    const cooldownMs = 30 * 60 * 1000; // 30 minut

    if (Date.now() - lastViewedAt > cooldownMs) {
      // Časovač se drží v ref a ruší se při odchodu ze stránky nebo změně
      // videa. Dřív doběhl vždycky: kdo video zavřel po dvou vteřinách,
      // stejně mu za tři vteřiny přičetl zhlédnutí - přesně to, čemu má
      // těch pět vteřin bránit.
      if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
      viewTimerRef.current = setTimeout(() => {
        viewTimerRef.current = null;
        fetch('/api/videos/increment-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Posíláme i to, odkud divák přišel a na čem se dívá - ve
          // statistikách je pak vidět, co kanálu vozí diváky a na jakém
          // zařízení se Kine používá.
          body: JSON.stringify({ videoId, source: detectViewSource(), device: detectDeviceClass() }),
        });
        localStorage.setItem(lastViewKey, String(Date.now()));
      }, 5000);
    }

    if (data.profiles) {
      computeTrustRatingClient(data.profiles.id, data.profiles.created_at).then(async (score) => {
        const reactionCount = await getTotalReactionCount(data.profiles.id);
        if (reactionCount >= RATING_UNLOCK_THRESHOLD) setTrustRating(score);
      });
    }

    setLoading(false);
  }

  async function computeTrustRatingClient(profileId: string, createdAt: string): Promise<number> {
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const ageScore = Math.min(ageDays / 180, 1);

    const { data: videos } = await supabase.from('videos').select('id').eq('owner_id', profileId);
    const videoIds = (videos ?? []).map((v) => v.id);

    let likeRatio = 0.9;
    if (videoIds.length > 0) {
      const { data: reactions } = await supabase.from('video_reactions').select('score').in('video_id', videoIds);
      if (reactions && reactions.length > 0) {
        const avg = reactions.reduce((sum, r) => sum + (r.score ?? 3), 0) / reactions.length;
        likeRatio = (avg - 1) / 4;
      }
    }

    return Math.round(Math.min(Math.max(60 + ageScore * 20 + likeRatio * 20, 50), 99));
  }

  async function handleModDelete() {
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/videos/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token}`,
      },
      body: JSON.stringify({ videoId }),
    });
    setConfirmModDelete(false);
    if (res.ok) {
      router.push('/');
    } else {
      setToast({ message: t('twoFactorGenericError'), type: 'error' });
    }
  }

  // Sdílení: na telefonu systémové okno, na počítači schránka (lib/share.ts).
  // Zavření okna bez výběru nic nehlásí - není to chyba.
  async function shareUrl(url: string) {
    setShareMenuOpen(false);
    const outcome = await shareLink({ url, title: video?.title ?? 'Kine' }, browserShareDeps());
    if (outcome === 'copied') setToast({ message: t('menuLinkCopied'), type: 'success' });
    if (outcome === 'failed') setToast({ message: url, type: 'error' });
  }

  async function shareVideo() {
    await shareUrl(`${window.location.origin}/watch/${videoId}`);
  }

  async function shareMoment() {
    const seconds = Math.floor(playerRef.current?.currentTime ?? 0);
    await shareUrl(`${window.location.origin}/watch/${videoId}?t=${seconds}`);
  }

  async function toggleWatchLater() {
    if (!userId) {
      router.push('/login');
      return;
    }

    let { data: systemPlaylist } = await supabase
      .from('playlists')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_system', true)
      .maybeSingle();

    // Systémový playlist "Sledovat později" zakládá registrace - a to bez
    // kontroly, jestli se to povedlo. Komu tehdy zápis selhal, ten ho nemá
    // vůbec, a tlačítko tady se dosud jen tiše vrátilo: kliknutí, nic se
    // nestalo, žádná hláška. Chybějící playlist se proto založí teď.
    if (!systemPlaylist) {
      const { data: created, error: createError } = await supabase
        .from('playlists')
        .insert({ owner_id: userId, title: t('watchLater'), color: '#3a5a8a', is_system: true })
        .select('id')
        .single();

      if (createError || !created) {
        setToast({ message: t('menuActionFailed'), type: 'error' });
        return;
      }
      systemPlaylist = created;
    }

    if (inWatchLater) {
      const { error } = await supabase
        .from('playlist_videos')
        .delete()
        .eq('playlist_id', systemPlaylist.id)
        .eq('video_id', videoId);

      if (error) {
        setToast({ message: t('menuActionFailed'), type: 'error' });
        return;
      }
      setInWatchLater(false);
    } else {
      // Chyba se tu dřív nečetla, takže se tlačítko přeplo na "✓" i když
      // se nic neuložilo. Po obnovení stránky bylo video pryč a vypadalo
      // to, že appka maže seznamy.
      const { error } = await supabase
        .from('playlist_videos')
        .upsert({ playlist_id: systemPlaylist.id, video_id: videoId });

      if (error) {
        setToast({ message: t('menuActionFailed'), type: 'error' });
        return;
      }
      setInWatchLater(true);
    }
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (notFound || !video) {
    return (
      <div className="auth-gate">
        <p>{t('videoNotFoundOrNoAccessNote')}</p>
        {notFoundDetail && (
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
            {t('technicalDetailNote').replace('{detail}', notFoundDetail)}
          </p>
        )}
      </div>
    );
  }

  const creatorName = video.profiles?.display_name ?? video.profiles?.username ?? t('unknownCreator');
  const chapters: { time: number; title: string }[] = video.chapters ?? [];
  const captions: { time: number; text: string }[] = video.captions ?? [];
  hasCaptionsRef.current = captions.length > 0;
  const miniActive = !!mini && !isMaximized;

  return (
    <div className="watch-layout">
      <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" onLoad={handlePlayerSdkReady} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <WatchHistoryTracker videoId={video.id} />
      <div className="watch-video-column">
        {/* U hudby si stránka vlastní přehrávač nezakládá vůbec - ani
            v režimu Video. Hraje jeden jediný přehrávač v kostře appky,
            takže hudba jde s divákem i po odchodu ze stránky; v režimu
            Video se jeho obraz jen promítne do krabice níž. Dva
            přehrávače téhož videa si lezly do zelí a právě proto se
            video po přepnutí nikdy nenačetlo. */}
        {mode === 'music' ? (
          showMusicStage ? (
            <MusicStage />
          ) : (
            <MusicVideoSurface vertical={video.height > video.width} />
          )
        ) : (
                <div
                  ref={dockRef}
                  className={mini ? 'player-dock player-dock-mini' : 'player-dock'}
                  // V mini režimu krabice drží změřenou výšku, aby stránka pod ní
                  // neposkočila, když se z ní rámeček odpojí do rohu.
                  style={mini ? { height: mini.height } : undefined}
                >
                  <div
                    ref={wrapRef}
                    // tabIndex dělá z rámečku místo, kam se dá vrátit focus, když si
                    // ho vezme iframe přehrávače - bez toho klávesové zkratky umřou.
                    tabIndex={0}
                    onMouseDown={() => wrapRef.current?.focus({ preventScroll: true })}
                    className={`player-wrap ${video.height > video.width ? 'player-wrap-vertical' : ''} ${cssFullscreen ? 'player-wrap-maximized' : ''} ${miniActive ? 'player-wrap-mini' : ''}`}
                    style={video.height > video.width || isMaximized ? {} : { aspectRatio: '16/9' }}
                  >
                    {miniActive && (
                      <div className="player-mini-bar">
                        <button
                          type="button"
                          className="player-mini-btn"
                          onClick={(e) => { e.stopPropagation(); leaveMini(true); }}
                          aria-label={t('miniPlayerExpand')}
                          title={t('miniPlayerExpand')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M15 3h6v6" />
                            <path d="M10 14 21 3" />
                            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="player-mini-btn"
                          onClick={(e) => { e.stopPropagation(); leaveMini(false); }}
                          aria-label={t('miniPlayerClose')}
                          title={t('miniPlayerClose')}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <iframe
                      ref={iframeRef}
                      // preload=auto: manifest a první kousky videa se stáhnou hned
                      // při otevření stránky, ne až po kliknutí na Přehrát - u delších
                      // videí se jinak po kliknutí dlouho čekalo.
                      src={`https://iframe.videodelivery.net/${video.playback_id ?? video.cloudflare_video_id}?controls=false&preload=auto`}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
                      allowFullScreen
                      tabIndex={-1}
                    />

                    {keyHint && (
                      // key se mění s každým stiskem, takže React prvek nasadí znovu
                      // a animace se rozjede od začátku i při rychlém mačkání.
                      <div key={keyHint.nonce} className="player-key-hint" aria-live="polite">
                        {keyHint.text}
                      </div>
                    )}
                    {!playerReady && video.thumbnail_url && (
                      <div
                        style={{
                          position: 'absolute', inset: 0, zIndex: 5,
                          backgroundImage: `url(${video.thumbnail_url})`,
                          backgroundSize: 'cover', backgroundPosition: 'center',
                        }}
                      />
                    )}
                    {/* Záchranná brzda. Přehrávač jede bez vlastního
                        ovládání, takže když se sám nerozjede, nedalo se
                        s ním do teď udělat vůbec nic. */}
                    {needsPlayTap && (
                      <button
                        type="button"
                        className="player-tap-to-play"
                        onClick={() => {
                          setNeedsPlayTap(false);
                          playerRef.current?.play?.();
                        }}
                      >
                        <span className="player-tap-to-play-icon" aria-hidden="true" />
                        {t('tapToPlay')}
                      </button>
                    )}
                    {video.is_ai_generated && showAiBadge && (
                      <div
                        className="player-ai-badge"
                        style={{
                          position: 'absolute', top: 10, right: 10, zIndex: 6,
                          background: 'rgba(10,10,11,0.75)', color: '#fff', fontSize: 11, fontWeight: 600,
                          padding: '4px 9px', borderRadius: 6, letterSpacing: 0.3,
                        }}
                      >
                        {t('aiContentBadge')}
                      </div>
                    )}
                    {playerReady && (
                      <ChapterTimeline
                        chapters={chapters}
                        duration={video.duration_seconds ?? 0}
                        player={playerRef.current}
                        hasCaptions={captions.length > 0}
                        captionsEnabled={captionsEnabled}
                        onToggleCaptions={() => setCaptionsEnabled((v) => !v)}
                        isMaximized={isMaximized}
                        onToggleMaximize={toggleFullscreen}
                        compact={miniActive}
                      />
                    )}
                    {playerReady && captions.length > 0 && captionsEnabled && (
                      <CaptionsOverlay captions={captions} player={playerRef.current} />
                    )}
                    {showUpNext && upNextQueue[0] && (
                      <div className="player-upnext" style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,11,0.92)', zIndex: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <div style={{ textAlign: 'center', maxWidth: 820, width: '100%' }}>
                          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 14 }}>
                            {t('nextVideoInSecondsNote').replace('{seconds}', String(upNextCountdown))}
                          </p>
                          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
                            {upNextQueue.slice(0, 2).map((v: any) => (
                              <div
                                key={v.id}
                                className="player-upnext-card"
                                onClick={() => router.push(nextHref(v.id))}
                                style={{ cursor: 'pointer', width: 'clamp(200px, 38vw, 340px)' }}
                              >
                                <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 8, aspectRatio: '16 / 9', position: 'relative' }}>
                                  {v.thumbnail_url && (
                                    <Image src={v.thumbnail_url} alt={v.title} fill style={{ objectFit: 'cover' }} />
                                  )}
                                </div>
                                <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0 }}>{v.title}</p>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => setShowUpNext(false)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', marginTop: 18 }}>
                            {t('cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
        )}

        {mode === 'music' && (
          <div className="music-view-switch" role="group" aria-label={t('musicViewSwitch')}>
            <button
              type="button"
              className={musicView === 'cover' ? 'music-view-option music-view-option-active' : 'music-view-option'}
              onClick={() => changeMusicView('cover')}
              aria-pressed={musicView === 'cover'}
            >
              {t('musicViewCover')}
            </button>
            <button
              type="button"
              className={musicView === 'video' ? 'music-view-option music-view-option-active' : 'music-view-option'}
              onClick={() => changeMusicView('video')}
              aria-pressed={musicView === 'video'}
            >
              {t('musicViewVideo')}
            </button>
          </div>
        )}

        {/* Fronta - videa přidaná přes ⋮ na kartě. Hraje se přednostně před
            playlistem i doporučenými videy. */}
        {queue.length > 0 && (
          <div className="playlist-panel">
            <div className="playlist-panel-head">
              <div style={{ minWidth: 0 }}>
                <p className="playlist-panel-title" style={{ margin: 0 }}>{t('queuePanelTitle')}</p>
                <p className="playlist-panel-sub">
                  {videoCountLabel(queue.length, lang, t)}
                </p>
              </div>
              <button onClick={clearQueue} className="playlist-panel-toggle" style={{ width: 'auto', padding: '0 10px', fontSize: 12 }}>
                {t('queueClear')}
              </button>
            </div>

            <div className="playlist-panel-list">
              {queue.map((v, i) => (
                <div key={v.id} className={`playlist-panel-item ${v.id === videoId ? 'current' : ''}`}>
                  <Link href={`/watch/${v.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <span className="playlist-panel-index">{v.id === videoId ? '▶' : i + 1}</span>
                    <span className="playlist-panel-thumb">
                      {v.thumbnail_url && (
                        <Image src={v.thumbnail_url} alt={v.title} width={96} height={54} style={{ objectFit: 'cover' }} />
                      )}
                      {!!v.duration_seconds && v.duration_seconds > 0 && (
                        <span className="playlist-panel-duration">{formatChapterTime(v.duration_seconds)}</span>
                      )}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="playlist-panel-item-title">{v.title}</span>
                      <span className="playlist-panel-item-meta">{v.username ?? t('unknownCreator')}</span>
                    </span>
                  </Link>
                  <button
                    onClick={() => removeFromQueue(v.id)}
                    aria-label={t('queueRemove')}
                    style={{ background: 'none', color: 'var(--text-faint)', padding: '4px 8px', fontSize: 12 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Panel playlistu: místo tenkého proužku s dvěma odkazy je tu celý
            seznam videí, ve kterém je vidět, kde v playlistu jsi, a dá se
            přeskočit rovnou kamkoliv - tak, jak to má YouTube. */}
        {playlistInfo && (
          <div className="playlist-panel">
            <div className="playlist-panel-head">
              <div style={{ minWidth: 0 }}>
                <Link href={`/playlists/${playlistId}`} className="playlist-panel-title">
                  {playlistInfo.title}
                </Link>
                <p className="playlist-panel-sub">
                  {t('watchingFromPlaylistLabel')}
                  {playlistIndex >= 0 && ` · ${playlistIndex + 1}/${playlistVideos.length}`}
                </p>
              </div>
              <button
                onClick={() => setPlaylistPanelOpen((v) => !v)}
                className="playlist-panel-toggle"
                aria-label={playlistPanelOpen ? t('playlistCollapse') : t('playlistExpand')}
              >
                {playlistPanelOpen ? '▴' : '▾'}
              </button>
            </div>

            {playlistPanelOpen && (
              <div className="playlist-panel-list">
                {playlistVideos.map((v: any, i: number) => {
                  const isCurrent = v.id === videoId;
                  return (
                    <Link
                      key={v.id}
                      href={nextHref(v.id)}
                      className={`playlist-panel-item ${isCurrent ? 'current' : ''}`}
                      ref={isCurrent ? scrollCurrentIntoView : undefined}
                    >
                      <span className="playlist-panel-index">{isCurrent ? '▶' : i + 1}</span>
                      <span className="playlist-panel-thumb">
                        {v.thumbnail_url && (
                          <Image src={v.thumbnail_url} alt={v.title} width={96} height={54} style={{ objectFit: 'cover' }} />
                        )}
                        {v.duration_seconds > 0 && (
                          <span className="playlist-panel-duration">{formatChapterTime(v.duration_seconds)}</span>
                        )}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="playlist-panel-item-title">{v.title}</span>
                        <span className="playlist-panel-item-meta">{v.profiles?.username ?? t('unknownCreator')}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="playlist-panel-foot">
              <Link
                href={playlistIndex > 0 ? nextHref(playlistVideos[playlistIndex - 1].id) : '#'}
                className={`playlist-panel-nav ${playlistIndex > 0 ? '' : 'disabled'}`}
                aria-disabled={playlistIndex <= 0}
              >
                ← {t('playlistPrevButton')}
              </Link>
              <Link
                href={playlistNext ? nextHref(playlistNext.id) : '#'}
                className={`playlist-panel-nav ${playlistNext ? '' : 'disabled'}`}
                aria-disabled={!playlistNext}
              >
                {t('playlistNextButton')} →
              </Link>
            </div>
          </div>
        )}
        <h1 className="video-title">{video.title}</h1>
        <div className="video-meta" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <Link href={`/channel/${video.profiles?.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="profile-avatar-small" style={{ width: 28, height: 28 }}>
              {video.profiles?.avatar_url ? <img loading="lazy" decoding="async" src={video.profiles.avatar_url} alt={creatorName} /> : null}
            </span>
            <span>{creatorName}</span>
            <VerifiedBadge tier={video.profiles?.verification_tier} />
                {trustRating !== null && trustRating >= 90 && <span title={t('highRatingTitle').replace('{rating}', String(trustRating))} style={{ marginLeft: 5, fontSize: 13 }}>⭐</span>}
          </Link>
          <span>{video.views} {t('views')}</span>
        </div>

        {/* Spolutvůrci: profily všech, kdo se na videu podíleli, přímo pod
            videem - každý svoje jméno, avatar a odkaz na kanál. Dřív se
            mačkali jako pár překrytých koleček bez jmen. */}
        {collaborators.length > 0 && (
          <div className="collab-strip">
            <p className="collab-strip-label">{t('videoCreatorsLabel')}</p>

            <Link href={`/channel/${video.profiles?.id}`} className="collab-chip">
              <span className="profile-avatar-small" style={{ width: 26, height: 26 }}>
                {video.profiles?.avatar_url ? (
                  <img loading="lazy" decoding="async" src={video.profiles.avatar_url} alt={creatorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : null}
              </span>
              <span className="collab-chip-name">{creatorName}</span>
              <span className="collab-chip-role">{t('uploadedByRoleLabel')}</span>
            </Link>

            {collaborators.map((c) => (
              <Link key={c.id} href={`/channel/${c.id}`} className="collab-chip">
                <span className="profile-avatar-small" style={{ width: 26, height: 26 }}>
                  {c.avatar_url ? (
                    <img loading="lazy" decoding="async" src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </span>
                <span className="collab-chip-name">{c.username}</span>
                <span className="collab-chip-role">{t('coCreatorRoleLabel')}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="video-actions-row" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <VideoReactions videoId={video.id} ownerId={video.profiles?.id} />
          {video.profiles?.id && <SubscribeButton channelId={video.profiles.id} />}
          <div style={{ position: 'relative' }}>
            <button className="reaction-btn" onClick={() => setShareMenuOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShareIcon size={16} /> {t('share')}
            </button>
            {shareMenuOpen && (
              <div className="profile-dropdown" style={{ bottom: 'auto', top: 'calc(100% + 8px)', left: 0, width: 200 }}>
                <button className="profile-dropdown-item" onClick={shareVideo}>{t('shareVideo')}</button>
                <button className="profile-dropdown-item" onClick={shareMoment}>{t('shareMoment')}</button>
              </div>
            )}
          </div>
          <AddToPlaylist videoId={video.id} />
          <DownloadButton videoId={video.id} cloudflareVideoId={video.cloudflare_video_id} />
          <button className={`reaction-btn ${inWatchLater ? 'active' : ''}`} onClick={toggleWatchLater} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <WatchLaterIcon size={16} /> {inWatchLater ? `✓ ${t('watchLater')}` : t('watchLater')}
          </button>
          <button className="reaction-btn" onClick={() => setReportOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ReportIcon size={16} /> {t('report')}
          </button>
          {isModerator && (
            <button
              className="reaction-btn"
              onClick={() => setConfirmModDelete(true)}
              style={{ color: '#ff6b6b', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <TrashIcon size={16} /> {t('modDeleteVideoButton')}
            </button>
          )}
        </div>

        {reportOpen && <ReportModal videoId={video.id} onClose={() => setReportOpen(false)} />}
        {confirmModDelete && (
          <ConfirmDialog
            message={t('confirmDeleteVideo')}
            onConfirm={handleModDelete}
            onCancel={() => setConfirmModDelete(false)}
          />
        )}

        {video.has_paid_promotion && (
          <p style={{
            fontSize: 12, background: 'var(--panel-raised)', border: '1px solid var(--border)',
            padding: '8px 12px', borderRadius: 8, color: 'var(--text-dim)', marginTop: 10,
          }}>
            ⓘ Toto video obsahuje placenou propagaci
          </p>
        )}

        {video.is_premiere && video.scheduled_at && new Date(video.scheduled_at) > new Date() && (
          <p style={{
            fontSize: 13, background: 'var(--panel-raised)', border: '1px solid var(--border)',
            padding: '10px 12px', borderRadius: 8, color: 'var(--text)', marginTop: 10, fontWeight: 600,
          }}>
            🎬 Premiéra: video bude k přehrání {new Date(video.scheduled_at).toLocaleString('cs-CZ')}
          </p>
        )}
      </div>

      {otherVideos.length > 0 && (
        <div className="watch-recommendations">
          <p className="section-title">{t('otherVideosHeading')}</p>
          {/* Stejné karty jako na hlavní stránce - včetně nabídky ⋮ (fronta,
              uložit, playlist, nezajímá mě, nahlásit) a náhledu po najetí.
              Dřív tu byl vlastní zjednodušený odkaz bez nabídky. */}
          {buildVideoBlocks(otherVideos).map((block, bi) => (
            <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
              {block.items.map((v: any) => (
                <VideoCard
                  key={v.id}
                  video={v}
                  href={block.type === 'sparks' ? `/sparks?start=${v.id}` : `/watch/${v.id}`}
                  isSparks={block.type === 'sparks'}
                  formatDuration={formatDuration}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="watch-comments-column">
        <p className="section-title">{t('interactionPanelTitle')}</p>

        <div className="panel">
          <p className="panel-heading">{t('creatorProfileHeading')}</p>
          <div className="creator-row">
            <div className="creator-avatar" style={{ overflow: 'hidden' }}>
              {video.profiles?.avatar_url ? (
                <img loading="lazy" decoding="async" src={video.profiles.avatar_url} alt={creatorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : null}
            </div>
            <div>
              <Link href={`/channel/${video.profiles?.id}`} className="creator-name" style={{ display: 'block' }}>
                {creatorName}
                <VerifiedBadge tier={video.profiles?.verification_tier} />
                {trustRating !== null && trustRating >= 90 && <span title={t('highRatingTitle').replace('{rating}', String(trustRating))} style={{ marginLeft: 5, fontSize: 13 }}>⭐</span>}
              </Link>
              {trustRating !== null && (
                <p className="creator-trust">{t('creatorRatingLabel').replace('{rating}', String(trustRating))}</p>
              )}
            </div>
          </div>
        </div>

        <CommentSection
          videoId={video.id}
          description={video.description}
          ownerId={video.profiles?.id}
          onSeek={seekTo}
          video={{
            duration_seconds: video.duration_seconds,
            category: video.category,
            language: video.language,
            created_at: video.created_at,
            made_for_kids: video.made_for_kids,
            visibility: video.visibility,
            hashtags: video.hashtags,
            comments_disabled: video.comments_disabled,
          }}
        />
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={null}>
      <WatchPageInner />
    </Suspense>
  );
}
