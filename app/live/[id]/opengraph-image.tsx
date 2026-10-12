import { ImageResponse } from 'next/og';
import { liveThumbnailUrl, loadLivePreview } from '@/lib/livePreview';

/**
 * Obrázek náhledu odkazu na přenos: snímek z vysílání (od Cloudflare),
 * přes něj odznak LIVE, název a kanál. Když kanál zrovna nevysílá, jeho
 * banner nebo avatar a "Offline". Stejně to dělá Twitch - kdo dostane
 * odkaz do Discordu, hned vidí, co se vysílá.
 */
export const alt = 'Live stream on Kine';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 60;

/** Obrázek jako data URL (Satori ho pak nemusí stahovat sám); nejvýš 3 s, jinak nic. */
async function inline(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!/^image\/(jpeg|png|webp|gif)/.test(type)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 6 * 1024 * 1024) return null;
    return `data:${type.split(';')[0]};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export default async function LiveOpenGraphImage({ params }: { params: { id: string } }) {
  const preview = await loadLivePreview(params.id);
  const [background, avatar] = await Promise.all([
    inline(preview?.live && preview.videoUid ? liveThumbnailUrl(preview.videoUid) : preview?.bannerUrl ?? null),
    inline(preview?.avatarUrl ?? null),
  ]);
  const live = !!preview?.live;
  const name = preview ? clip(preview.name, 40) : 'Kine';
  const title = preview ? clip(preview.title || (live ? `${preview.name} is live` : `${preview.name} on Kine`), 90) : 'Live on Kine';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: '#07080a',
          backgroundImage: 'radial-gradient(circle at 70% 30%, #2a1214 0%, #0b0b0e 65%)',
          color: '#f2f2f0',
          fontFamily: 'sans-serif',
        }}
      >
        {background ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={background} alt="" width={1200} height={630} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: 1200, height: 630, objectFit: 'cover' }} />
        ) : null}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            backgroundImage: 'linear-gradient(180deg, rgba(5,5,6,0.15) 0%, rgba(5,5,6,0.25) 45%, rgba(5,5,6,0.92) 100%)',
          }}
        />
        <div style={{ position: 'absolute', top: 40, left: 48, display: 'flex' }}>
          {live ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                backgroundColor: '#e5262a',
                color: '#fff',
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: 2,
                padding: '8px 22px',
                borderRadius: 10,
              }}
            >
              <div style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' }} />
              LIVE
            </div>
          ) : (
            <div style={{ display: 'flex', backgroundColor: 'rgba(255,255,255,0.14)', fontSize: 30, fontWeight: 700, padding: '8px 20px', borderRadius: 10 }}>
              OFFLINE
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', top: 40, right: 48, display: 'flex', alignItems: 'center', gap: 14, fontSize: 40, fontWeight: 800 }}>
          <div
            style={{ width: 46, height: 46, borderRadius: 12, border: '4px solid #00c9a7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="18" height="20" viewBox="0 0 18 20" style={{ marginLeft: 4 }}>
              <path d="M2 2 L16 10 L2 18 Z" fill="#00c9a7" stroke="#00c9a7" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          Kine
        </div>
        <div style={{ position: 'absolute', left: 48, right: 48, bottom: 44, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.12 }}>{title}</div>
          {preview ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 34, color: '#d6d6dc' }}>
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" width={64} height={64} style={{ width: 64, height: 64, borderRadius: 32, objectFit: 'cover', border: live ? '4px solid #e5262a' : '4px solid #2a2a30' }} />
              ) : null}
              <span style={{ fontWeight: 700, color: '#fff' }}>{name}</span>
              <span>{live ? 'is streaming on Kine' : 'on Kine'}</span>
            </div>
          ) : (
            // Kanál nenalezen (nebo databáze neodpověděla): jen obecný řádek, ne "Kine on Kine".
            <div style={{ display: 'flex', fontSize: 34, color: '#d6d6dc' }}>Live streams, chat and clips</div>
          )}
        </div>
      </div>
    ),
    size
  );
}
