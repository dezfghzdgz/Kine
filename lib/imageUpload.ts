/**
 * Obrázky, které lidi nahrávají do úložiště Kine (náhledy videí, obrázky
 * v příspěvcích a komentářích, obálky playlistů).
 *
 * Úložiště má od migrace supabase-migration-zabezpeceni-a-limity.sql
 * pravidla: jen obrázky (JPEG, PNG, WebP, GIF, AVIF), jen do vlastní složky,
 * omezená velikost a počet za den, náhled jen k vlastnímu videu. Tady je
 * totéž na straně prohlížeče, ať člověk dostane srozumitelnou hlášku dřív,
 * než se soubor začne nahrávat - a ať názvy souborů pravidlům odpovídají
 * (přípona podle typu souboru, ne podle toho, jak se soubor jmenuje).
 *
 * Čistá logika (tests/uploadLimits.test.mjs).
 */

export const IMAGE_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/apng': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Největší soubory (stejné stropy má úložiště - file_size_limit u bucketu). */
export const IMAGE_MAX_BYTES = {
  thumbnail: 10 * 1024 * 1024,
  post: 10 * 1024 * 1024,
  comment: 10 * 1024 * 1024,
  playlistCover: 5 * 1024 * 1024,
} as const;

export type ImageKind = keyof typeof IMAGE_MAX_BYTES;

/** Přípona podle typu souboru; null = tohle nahrát nejde (SVG, HEIC, cokoli jiného). */
export function imageUploadExt(file: { type?: string | null; name?: string | null }): string | null {
  const type = (file.type ?? '').toLowerCase().trim();
  if (IMAGE_UPLOAD_TYPES[type]) return IMAGE_UPLOAD_TYPES[type];
  // Některé prohlížeče typ nevyplní - podle přípony, ale jen u známých obrázků.
  if (!type) {
    const ext = (file.name ?? '').split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'jpeg' || ext === 'jpg') return 'jpg';
    if (ext === 'png' || ext === 'webp' || ext === 'gif' || ext === 'avif') return ext;
  }
  return null;
}

/** 'type' = nepodporovaný formát, 'size' = moc velký, null = v pořádku. */
export function imageUploadProblem(file: { type?: string | null; name?: string | null; size: number }, kind: ImageKind): 'type' | 'size' | null {
  if (!imageUploadExt(file)) return 'type';
  if (!(file.size > 0) || file.size > IMAGE_MAX_BYTES[kind]) return 'size';
  return null;
}

/** Krátká jedinečná přípona jména (čas v base36) - každý nový náhled má vlastní soubor. */
function stamp(now = Date.now()): string {
  return now.toString(36);
}

/**
 * Náhled videa: <uživatel>/<video>-<čas>.<přípona>. Každý nový náhled je nový
 * soubor (přepsat starý nejde) - jinak by šlo po kontrole obsahu potichu
 * podstrčit jiný obrázek pod stejnou adresou.
 */
export function thumbnailPath(userId: string, videoId: string, ext: string, now = Date.now()): string {
  return `${userId}/${videoId}-${stamp(now)}.${ext}`;
}

/** Cesta souboru v bucketu z veřejné adresy úložiště (jen vlastní složka), jinak null. */
export function ownStoragePath(publicUrl: string | null | undefined, bucket: string, userId: string): string | null {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = publicUrl.indexOf(marker);
  if (at < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(publicUrl.slice(at + marker.length).split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (!path.startsWith(`${userId}/`) || path.includes('..')) return null;
  return path;
}
