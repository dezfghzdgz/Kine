/**
 * Obraz v obraze (Picture-in-Picture): video v plovoucím okénku i mimo
 * prohlížeč. Standardní API (Chrome, Edge, Safari 13.1+) a starší způsob
 * Safari na iPhonu/iPadu (webkitSetPresentationMode). Jen pro vlastní
 * <video> - iframe přehrávače Cloudflare se zvenku do okénka dát nedá
 * (jeho obal z SDK žádné .element nemá, tlačítko se pak neukáže).
 */

type PipVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
};

/** Samotné <video> - i z obalu přehrávače stránky videa (mediaPlayer v lib/vodPlayer.ts má .element). */
function asVideo(el: unknown): PipVideo | null {
  if (typeof HTMLVideoElement === 'undefined' || !el) return null;
  if (el instanceof HTMLVideoElement) return el as PipVideo;
  const inner = (el as { element?: unknown }).element;
  return inner instanceof HTMLVideoElement ? (inner as PipVideo) : null;
}

export function pipSupported(el: unknown): boolean {
  const video = asVideo(el);
  if (!video || typeof document === 'undefined') return false;
  const doc = document as Document & { pictureInPictureEnabled?: boolean };
  if (doc.pictureInPictureEnabled === true && typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture) return true;
  return typeof video.webkitSupportsPresentationMode === 'function' && video.webkitSupportsPresentationMode('picture-in-picture');
}

export function pipActive(el: unknown): boolean {
  const video = asVideo(el);
  if (!video || typeof document === 'undefined') return false;
  const doc = document as Document & { pictureInPictureElement?: Element | null };
  return doc.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
}

/** Zapne/vypne okénko. Když ho prohlížeč odmítne (video ještě nemá obraz), nic se nestane. */
export function togglePictureInPicture(el: unknown): void {
  const video = asVideo(el);
  if (!video) return;
  const doc = document as Document & {
    pictureInPictureEnabled?: boolean;
    pictureInPictureElement?: Element | null;
    exitPictureInPicture?: () => Promise<void>;
  };
  try {
    if (doc.pictureInPictureElement === video) {
      doc.exitPictureInPicture?.().catch(() => {});
    } else if (video.webkitPresentationMode === 'picture-in-picture') {
      video.webkitSetPresentationMode?.('inline');
    } else if (doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
      video.requestPictureInPicture().catch(() => {});
    } else {
      video.webkitSetPresentationMode?.('picture-in-picture');
    }
  } catch {
    // Starší prohlížeč hodil výjimku místo odmítnutého slibu - nic se nestane.
  }
}

/** Sleduje zapnutí/vypnutí okénka (i zavření křížkem v okénku). Vrací odhlášení. */
export function watchPictureInPicture(el: unknown, onChange: (active: boolean) => void): () => void {
  const video = asVideo(el);
  if (!video) return () => {};
  const sync = () => onChange(pipActive(video));
  video.addEventListener('enterpictureinpicture', sync);
  video.addEventListener('leavepictureinpicture', sync);
  video.addEventListener('webkitpresentationmodechanged', sync);
  return () => {
    video.removeEventListener('enterpictureinpicture', sync);
    video.removeEventListener('leavepictureinpicture', sync);
    video.removeEventListener('webkitpresentationmodechanged', sync);
  };
}
