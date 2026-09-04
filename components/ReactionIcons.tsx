/**
 * Reproduktor.
 *
 * Vlnky přibývají s hlasitostí, při ztlumení je přeškrtnutý. Jde tak poznat
 * nejen jestli je zvuk zapnutý, ale i jak nahlas hraje - a to bez najíždění
 * myší na posuvník, který je schovaný.
 *
 * "volume" je nepovinné kvůli místům, která hlasitost nesledují a znají jen
 * ztlumeno/nezticha.
 */
export function SpeakerIcon({ muted, volume, size = 16 }: { muted?: boolean; volume?: number; size?: number }) {
  const level = muted ? 0 : volume ?? 1;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
      {level <= 0 ? (
        <path d="M17 9l5 6M22 9l-5 6" strokeLinecap="round" />
      ) : (
        <>
          <path d="M17 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
          {level > 0.5 && <path d="M20 6a9 9 0 0 1 0 12" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

export function CommentIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" strokeLinejoin="round" />
    </svg>
  );
}

export function ShareIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" strokeLinecap="round" />
    </svg>
  );
}
export function ThumbsUpIcon({ filled, size = 20 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z" strokeLinejoin="round" />
      <path d="M7 11l3.5-7a2 2 0 0 1 2-1c1.1 0 2 .9 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 18.3 20H7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ThumbsDownIcon({ filled, size = 20 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z" strokeLinejoin="round" />
      <path d="M17 13l-3.5 7a2 2 0 0 1-2 1c-1.1 0-2-.9-2-2v-4H4.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 5.7 4H17" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function PlaylistIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h12M4 12h12M4 18h7" strokeLinecap="round" />
      <path d="M18 10v10M14 15l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v13M7 11l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" strokeLinecap="round" />
    </svg>
  );
}

export function WatchLaterIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2h6" strokeLinecap="round" />
    </svg>
  );
}

export function ReportIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 3v18" strokeLinecap="round" />
      <path d="M5 4h11l-2.5 3.5L16 11H5" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BellIcon({ muted, size = 18 }: { muted?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6z" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
      {muted && <path d="M3 3l18 18" strokeLinecap="round" />}
    </svg>
  );
}

export function FireIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 22c4 0 7-2.7 7-6.5 0-3-2-5-3-7 0 2-1.5 3-2.5 2 .5-3-1-5.5-3.5-7.5.5 3-1 4.5-3 6.5-1.5 1.5-2 3.5-2 6C5 19.3 8 22 12 22z" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" strokeLinecap="round" />
      <path d="M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function DiceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TagIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M11 3h6a2 2 0 0 1 2 2v6l-8.6 8.6a1.4 1.4 0 0 1-2 0L3.4 14.6a1.4 1.4 0 0 1 0-2L11 3z" strokeLinejoin="round" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MaximizeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MinimizeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PeopleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M21 20c0-2.8-2-5.1-4.6-5.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Ikonky kategorií v Explore ----------
   Každá kategorie má vlastní obrázek, ať se dají rozeznat od sebe na první
   pohled. Dřív měly všechny stejný štítek. Kreslené stejným stylem jako
   zbytek appky: čára tloušťky 1.8, mřížka 24x24, bez výplně. */

export function CarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 13l1.8-5.2A2 2 0 0 1 6.7 6.5h10.6a2 2 0 0 1 1.9 1.3L21 13v4.5h-3V16H6v1.5H3V13z" strokeLinejoin="round" />
      <path d="M3.6 13h16.8" strokeLinecap="round" />
      <circle cx="7.2" cy="16" r="1.3" />
      <circle cx="16.8" cy="16" r="1.3" />
    </svg>
  );
}

export function PlaneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 15.5l-8-3V6.2a1.5 1.5 0 0 0-3 0v6.3l-8 3V17l8-1.8v3.1l-2 1.4V21l3.5-.9L15 21v-1.3l-2-1.4v-3.1L21 17v-1.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function FilmIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3 12h18M3 8.2h4.5M3 15.8h4.5M16.5 8.2H21M16.5 15.8H21" strokeLinecap="round" />
    </svg>
  );
}

export function GamepadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.6 3a2.6 2.6 0 0 1-4.6 1.1L14.4 16H9.6l-1.3 1.5a2.6 2.6 0 0 1-4.6-1.1l-.6-3A4.5 4.5 0 0 1 7.5 8z" strokeLinejoin="round" />
      <path d="M7 11v2.4M5.8 12.2h2.4" strokeLinecap="round" />
      <circle cx="15.6" cy="11.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="13.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MusicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 18V5.5l10-2v12" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="15.5" r="2.5" />
    </svg>
  );
}

export function ComedyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 13.5c1 2.2 2.6 3.3 4.5 3.3s3.5-1.1 4.5-3.3z" strokeLinejoin="round" />
      <path d="M8.2 9.2h1.6M14.2 9.2h1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BlogIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c.8-3.4 3.6-5.4 7-5.4s6.2 2 7 5.4" strokeLinecap="round" />
    </svg>
  );
}

export function HowToIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14.5 3.2a4.2 4.2 0 0 0-4.7 6.3L3.6 15.7a1.8 1.8 0 0 0 2.6 2.6l6.2-6.2a4.2 4.2 0 0 0 6.3-4.7l-2.6 2.6-2.5-.7-.7-2.5 2.6-2.6z" strokeLinejoin="round" />
    </svg>
  );
}

export function HeartHandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 9.6l-.9-.9a2.7 2.7 0 0 0-3.8 3.8l4.7 4.6 4.7-4.6a2.7 2.7 0 0 0-3.8-3.8l-.9.9z" strokeLinejoin="round" />
      <path d="M4 20.5c1.6-1.3 3.6-2 5.4-2h5.2c1.8 0 3.8.7 5.4 2" strokeLinecap="round" />
    </svg>
  );
}

export function SportsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c2.4 2.3 3.7 5.4 3.7 9S14.4 18.7 12 21M12 3C9.6 5.3 8.3 8.4 8.3 12s1.3 6.7 3.7 9" />
      <path d="M3.4 9.5h17.2M3.4 14.5h17.2" strokeLinecap="round" />
    </svg>
  );
}

export function ScienceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 3v6.2L5.2 17A2.2 2.2 0 0 0 7.1 20.4h9.8A2.2 2.2 0 0 0 18.8 17L14 9.2V3" strokeLinejoin="round" />
      <path d="M9 3h6M7.8 14.4h8.4" strokeLinecap="round" />
    </svg>
  );
}

export function EducationIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4.2L22 9l-10 4.8L2 9l10-4.8z" strokeLinejoin="round" />
      <path d="M6.5 11.3V16c0 1.5 2.5 2.8 5.5 2.8s5.5-1.3 5.5-2.8v-4.7" strokeLinecap="round" />
    </svg>
  );
}

export function EntertainmentIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3.2l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.4l5.9-.8L12 3.2z" strokeLinejoin="round" />
    </svg>
  );
}

export function NewsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5.5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2v-13z" strokeLinejoin="round" />
      <path d="M17 9.5h3v9a2 2 0 0 1-2 2" strokeLinejoin="round" />
      <path d="M7 9h7M7 12.5h7M7 16h4.5" strokeLinecap="round" />
    </svg>
  );
}

export function PetIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="16" rx="4.2" ry="3.4" />
      <ellipse cx="5.8" cy="11.4" rx="1.9" ry="2.4" />
      <ellipse cx="18.2" cy="11.4" rx="1.9" ry="2.4" />
      <ellipse cx="9.2" cy="6.8" rx="1.9" ry="2.4" />
      <ellipse cx="14.8" cy="6.8" rx="1.9" ry="2.4" />
    </svg>
  );
}

/* ---------- Ikonky pro nabídku ⋮ na kartě videa ---------- */

export function QueueIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6.5h11M3 12h11M3 17.5h7" strokeLinecap="round" />
      <path d="M17 9.5v9M21.5 14h-9" strokeLinecap="round" />
    </svg>
  );
}

export function NotInterestedIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" strokeLinecap="round" />
    </svg>
  );
}

export function BlockChannelIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12h9" strokeLinecap="round" />
    </svg>
  );
}
