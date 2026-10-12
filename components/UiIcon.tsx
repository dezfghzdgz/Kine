/**
 * Ikony rozhraní Kine (obrysové SVG v barvě textu) - stejná sada jako
 * v Kine do PC a Kine Clipper (kine-desktop/src/renderer/icons.ts), ať
 * nabídky a nastavení vypadají všude stejně a jde se podle ikon, ne podle
 * textu. Žádná emoji - ta vypadají na každém systému jinak.
 */
const PATHS = {
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .9-1 1.6v.4"/><path d="M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.3 2.3M9.5 3h5"/>',
  gauge: '<path d="M4.4 17.5a8.5 8.5 0 1 1 15.2 0"/><path d="M12 13.5l3.8-3.8"/><circle cx="12" cy="13.5" r="1.3" fill="currentColor" stroke="none"/>',
  quality: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9.5v5M10.5 9.5v5M7 12h3.5M13.5 9.5v5h1.6a2.5 2.5 0 0 0 0-5z"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.6 13 7.5 5h9l1.9 8"/><path d="M16.5 16.5h.01"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.4 1.6-2.4H17a4 4 0 0 0 4-4C21 7.5 17 3 12 3z"/><circle cx="7.6" cy="11.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.2" cy="7.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.6" cy="7.6" r="1.2" fill="currentColor" stroke="none"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  power: '<path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11"/>',
  play: '<path d="M8.5 5.8v12.4L18.5 12z" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  leaf: '<path d="M5 19C5 11 10 6 20 5c-1 10-6 15-14 15"/><path d="M5 19l7-7"/>',
  gamepad:
    '<path d="M7 8h10a4.5 4.5 0 0 1 4.5 4.5V15a2.6 2.6 0 0 1-4.7 1.5L15.4 14.5H8.6L7.2 16.5A2.6 2.6 0 0 1 2.5 15v-2.5A4.5 4.5 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11.2" r=".9" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13" r=".9" fill="currentColor" stroke="none"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M3.5 20.5 10 14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  starFilled: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8 8l12 10M8 16 20 6"/>',
  upload: '<path d="M12 15V5M8 9l4-4 4 4"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  chat: '<path d="M4 5.5h16v10.5H9l-5 4z"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8-1.8 5.2-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  broadcast:
    '<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.8L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.8L20 16"/><path d="M20 20v-4h-4"/>',
  desktop: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/><path d="M10 8.2v4.6l4-2.3z" fill="currentColor" stroke="none"/>',
  warning: '<path d="M12 3.8 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 16.9h.01"/>',
  battery: '<rect x="2.5" y="7.5" width="16.5" height="9" rx="2"/><path d="M21.5 10.5v3"/><path d="M5.5 10.5v3M8.5 10.5v3" stroke-width="2.4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  micOff: '<path d="M9 9V6a3 3 0 0 1 5.6-1.5M15 10.5V11a3 3 0 0 1-4.4 2.6"/><path d="M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M8.5 21h7M4 4l16 16"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
  undo: '<path d="M9 7.5 4.5 12 9 16.5"/><path d="M4.5 12H15a4.5 4.5 0 0 1 0 9h-2"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3.5h6v1M9 4.5a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1M8.5 11h7M8.5 15h5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 13.8a6.5 6.5 0 0 1 4 5.7"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 15.5l-5-5-9.5 9"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  pencil: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5-7.5-4z"/>',
  clipAdd: '<rect x="3" y="5" width="13.5" height="14" rx="2.5"/><path d="M16.5 10l4.5-2.5v9L16.5 14"/><path d="M9.75 9v6M6.75 12h6"/>',
  headphones: '<path d="M3.5 17v-4.5a8.5 8.5 0 0 1 17 0V17"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowRight: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  coins: '<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.4c.8.1 1.6.1 2.5.1 3 0 5.5-1.1 5.5-2.5v-4"/><path d="M14.5 10.6c1.7.3 3 1.1 3 2"/><path d="M3.5 11v4c0 1.4 2.5 2.5 5.5 2.5"/>',
  tv: '<rect x="3" y="5" width="18" height="12.5" rx="2"/><path d="M8 21h8M9 2.5l3 2.5 3-2.5"/>',
  logout: '<path d="M14.5 4.5h-8a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8"/><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
} as const;

export type UiIconName = keyof typeof PATHS;

export default function UiIcon({ name, size = 18, className }: { name: UiIconName; size?: number; className?: string }) {
  return (
    <svg
      className={`ui-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
