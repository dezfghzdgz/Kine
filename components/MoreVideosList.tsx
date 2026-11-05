'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { channelName } from '@/lib/channelName';
import { countLabel } from '@/lib/plural';
import { timeAgo } from '@/lib/timeAgo';
import { isSpark } from '@/lib/videoBlocks';
import { rememberVideoPeek } from '@/lib/videoPeek';
import { isUpcomingPremiere } from '@/lib/scheduling';
import { warmVideo } from '@/lib/warmVideo';

/**
 * „Další videa“ vedle přehrávače - úzký seznam (malý náhled vlevo, název a kanál
 * vpravo), jak ho lidi znají z YouTube. Dřív byla doporučená videa až pod
 * přehrávačem ve velkých kartách, takže kdo video dokoukal, žádné další neviděl.
 * Sparks vedou do přehrávače Sparks (na výšku), ostatní na stránku videa.
 */
export default function MoreVideosList({
  videos,
  formatDuration,
  playlistSuffix = '',
}: {
  videos: any[];
  formatDuration: (seconds: number) => string;
  /** Přípona adresy (playlist, ze kterého se kouká) - stejná jako u dalšího videa. */
  playlistSuffix?: string;
}) {
  const { t, lang } = useLanguage();
  if (videos.length === 0) return <p className="more-videos-empty">{t('noVideosYet')}</p>;
  return (
    <ul className="more-videos">
      {videos.map((v: any) => {
        const spark = isSpark(v);
        const href = spark ? `/sparks?start=${v.id}` : `/watch/${v.id}${playlistSuffix}`;
        const premiere = isUpcomingPremiere(v);
        const age = !premiere && v.created_at ? timeAgo(v.created_at, DATE_LOCALES[lang]) : '';
        return (
          <li key={v.id}>
            <Link
              href={href}
              className="more-video"
              onClick={() => rememberVideoPeek(v)}
              // Najetí myší: manifest a náhled se stáhnou dopředu (lib/warmVideo.ts) - po kliknutí video hned jede.
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse' && !premiere) warmVideo(v);
              }}
            >
              <span className={`more-video-thumb${spark ? ' more-video-thumb-spark' : ''}`}>
                {v.thumbnail_url && <Image src={v.thumbnail_url} alt="" width={168} height={94} style={{ objectFit: 'cover' }} />}
                {!premiere && v.duration_seconds > 0 && <span className="more-video-duration">{formatDuration(v.duration_seconds)}</span>}
                {premiere && <span className="more-video-duration">{t('premiereBadge')}</span>}
              </span>
              <span className="more-video-text">
                <span className="more-video-title">{v.title}</span>
                <span className="more-video-meta">{channelName(v.profiles, t('unknownCreator'))}</span>
                <span className="more-video-meta">
                  {typeof v.views === 'number' ? countLabel(v.views, lang, t, 'viewsCount') : ''}
                  {age && (typeof v.views === 'number' ? ' · ' : '')}
                  {age}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
