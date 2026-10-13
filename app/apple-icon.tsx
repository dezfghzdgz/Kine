import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * Ikona Kine pro iPhone/iPad (plocha) a dlaždice v Rychlé volbě Opery -
 * Opera si bere ikonu větší než 114 px (apple-touch-icon); bez ní ukazovala
 * jen barevné pole s adresou. Značka + nápis Kine, jako má YouTube své logo.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  const bold = await readFile(join(process.cwd(), 'lib', 'og-fonts', 'inter-latin-800-normal.woff'));
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          backgroundColor: '#07090a',
          backgroundImage: 'radial-gradient(circle at 50% 30%, rgba(0,201,167,0.38), rgba(0,201,167,0) 62%)',
          fontFamily: 'Inter',
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(140deg, rgba(0,201,167,0.32), rgba(0,201,167,0.1))',
            border: '2px solid rgba(0,201,167,0.7)',
          }}
        >
          <svg width="50" height="50" viewBox="0 0 24 24">
            <path d="M8 5.5v13l10.5-6.5z" fill="#00c9a7" stroke="#00c9a7" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, color: '#f4f4f2', lineHeight: 1 }}>Kine</div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Inter', data: bold, weight: 800, style: 'normal' }] }
  );
}
