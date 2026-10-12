import { ImageResponse } from 'next/og';

/**
 * Obrázek náhledu odkazu pro celý web (Discord, X, Messenger...), když
 * stránka nemá vlastní (video má svůj náhled, přenos svůj snímek). Dřív
 * nebyl žádný - sdílený odkaz byl jen šedý text. Anglicky, web je
 * v základu anglicky.
 */
export const alt = 'Kine - the video platform built on free expression';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 96px',
          backgroundColor: '#050506',
          backgroundImage: 'radial-gradient(circle at 78% 22%, #0f3a33 0%, #07090a 55%, #050506 100%)',
          color: '#f2f2f0',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              width: 112,
              height: 112,
              borderRadius: 28,
              border: '6px solid #00c9a7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Trojúhelník "přehrát" jako SVG - rámečkový trojúhelník z CSS kreslí Satori jako obdélník. */}
            <svg width="46" height="52" viewBox="0 0 46 52" style={{ marginLeft: 10 }}>
              <path d="M4 3 L43 26 L4 49 Z" fill="#00c9a7" stroke="#00c9a7" strokeWidth="4" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -4 }}>Kine</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 50, fontWeight: 700, lineHeight: 1.15, maxWidth: 940 }}>
          The video platform built on free expression
        </div>
        <div style={{ marginTop: 26, fontSize: 30, color: '#9a9aa2', display: 'flex', gap: 22 }}>
          <span>Videos</span>
          <span style={{ color: '#00c9a7' }}>·</span>
          <span>Sparks</span>
          <span style={{ color: '#00c9a7' }}>·</span>
          <span>Live streams</span>
          <span style={{ color: '#00c9a7' }}>·</span>
          <span>Clips</span>
        </div>
      </div>
    ),
    size
  );
}
