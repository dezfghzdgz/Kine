import { ImageResponse } from 'next/og';

/**
 * Velká ikona Kine (512 px) vedle malé SVG v app/icon.svg - pro prohlížeče a
 * dlaždice, které chtějí obrázek (Opera, Android "přidat na plochu"). Jen
 * značka, bez nápisu - kdyby si ji prohlížeč vzal i na kartu, je čitelná.
 */
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function BigIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0b',
          backgroundImage: 'radial-gradient(circle at 50% 42%, rgba(0,201,167,0.30), rgba(0,201,167,0.08) 70%)',
          borderRadius: 112,
        }}
      >
        <svg width="300" height="300" viewBox="0 0 24 24">
          <path d="M8 5.5v13l10.5-6.5z" fill="#00c9a7" stroke="#00c9a7" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size
  );
}
