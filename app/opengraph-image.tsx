import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * Obrázek náhledu odkazu pro celý web (Discord, X, Messenger...), když
 * stránka nemá vlastní (video má svůj náhled, přenos svůj snímek).
 * Anglicky, web je v základu anglicky.
 *
 * Vlevo značka a jedna věta, vpravo "kousek appky" (video, Sparks, živě,
 * klip) - aby bylo hned vidět, co Kine je, ne jen přečíst. Písmo Inter je
 * přibalené (lib/og-fonts, OFL) - výchozí písmo obrázků umí jen tenký řez
 * a nápis Kine byl hubený.
 */
export const alt = 'Kine - videos, Sparks, live streams and game clips';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BRAND = '#00c9a7';

function PlayIcon({ size: s, color }: { size: number; color: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24">
      <path d="M8 5.5v13l10.5-6.5z" fill={color} stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function Chip({ label, dot }: { label: string; dot: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 18px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#e7e7ea',
        fontSize: 24,
        fontWeight: 500,
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: 999, background: dot }} />
      {label}
    </div>
  );
}

export default async function OpenGraphImage() {
  const fontDir = join(process.cwd(), 'lib', 'og-fonts');
  const [bold, medium] = await Promise.all([
    readFile(join(fontDir, 'inter-latin-800-normal.woff')),
    readFile(join(fontDir, 'inter-latin-500-normal.woff')),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: '#06070a',
          backgroundImage:
            'radial-gradient(circle at 82% 18%, rgba(0,201,167,0.32), rgba(0,201,167,0) 46%), radial-gradient(circle at 8% 105%, rgba(124,58,237,0.24), rgba(124,58,237,0) 50%)',
          color: '#f4f4f2',
          fontFamily: 'Inter',
          overflow: 'hidden',
        }}
      >
        {/* Vlevo: značka, věta, druhy obsahu, adresa */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 0 0 80px', width: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            <div
              style={{
                width: 104,
                height: 104,
                borderRadius: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(140deg, rgba(0,201,167,0.30), rgba(0,201,167,0.08))',
                border: '2px solid rgba(0,201,167,0.65)',
                boxShadow: '0 0 60px rgba(0,201,167,0.35)',
              }}
            >
              <PlayIcon size={62} color={BRAND} />
            </div>
            <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -6, lineHeight: 1 }}>Kine</div>
          </div>
          <div style={{ marginTop: 40, fontSize: 46, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1, maxWidth: 540 }}>
            The video platform built on free expression
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30, maxWidth: 560 }}>
            <Chip label="Videos" dot={BRAND} />
            <Chip label="Sparks" dot="#c084fc" />
            <Chip label="Live" dot="#ff4d4d" />
            <Chip label="Clips" dot="#fbbf24" />
          </div>
          <div style={{ marginTop: 34, fontSize: 26, fontWeight: 500, color: BRAND, letterSpacing: 0.5 }}>playkine.com</div>
        </div>

        {/* Vpravo: kousek appky - video, Sparks na výšku, štítek ŽIVĚ, klip */}
        <div style={{ display: 'flex', position: 'relative', flex: 1 }}>
          <div
            style={{
              position: 'absolute',
              left: 40,
              top: 120,
              display: 'flex',
              transform: 'rotate(-7deg)',
            }}
          >
            {/* Video 16:9 */}
            <div
              style={{
                width: 430,
                height: 242,
                borderRadius: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                backgroundImage: 'linear-gradient(135deg, #0f766e 0%, #0e7490 45%, #1e3a8a 100%)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
              }}
            >
              <div
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: 999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.92)',
                }}
              >
                <PlayIcon size={44} color="#0b1220" />
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 18,
                  left: 18,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 20,
                  fontWeight: 800,
                  letterSpacing: 1,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: 999, background: '#fff' }} />
                LIVE
              </div>
              <div style={{ position: 'absolute', left: 22, right: 22, bottom: 20, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.25)', display: 'flex' }}>
                <div style={{ width: '62%', height: 6, borderRadius: 999, background: BRAND }} />
              </div>
            </div>
          </div>

          {/* Sparks na výšku */}
          <div
            style={{
              position: 'absolute',
              left: 300,
              top: 300,
              width: 150,
              height: 266,
              borderRadius: 24,
              display: 'flex',
              alignItems: 'flex-end',
              padding: 16,
              backgroundImage: 'linear-gradient(160deg, #a855f7 0%, #db2777 100%)',
              border: '1px solid rgba(255,255,255,0.2)',
              boxShadow: '0 30px 70px rgba(0,0,0,0.5)',
              transform: 'rotate(6deg)',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24">
              <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" fill="#fff" />
            </svg>
          </div>

          {/* Klip ze hry: zvuková stopa */}
          <div
            style={{
              position: 'absolute',
              left: 20,
              top: 412,
              width: 250,
              height: 92,
              borderRadius: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 20px',
              background: 'rgba(17,18,24,0.92)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
              transform: 'rotate(-4deg)',
            }}
          >
            {[18, 34, 52, 30, 60, 44, 24, 48, 36, 20, 40].map((h, i) => (
              <div key={i} style={{ width: 8, height: h, borderRadius: 4, background: i < 6 ? '#fbbf24' : 'rgba(255,255,255,0.35)' }} />
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Inter', data: bold, weight: 800, style: 'normal' },
        { name: 'Inter', data: medium, weight: 500, style: 'normal' },
      ],
    }
  );
}
