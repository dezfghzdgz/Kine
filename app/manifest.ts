import type { MetadataRoute } from 'next';

/**
 * Manifest webové appky (playkine.com/manifest.webmanifest) - podle něj
 * telefon pozná, že Kine jde přidat na plochu jako appku: jméno a ikona na
 * ploše, celá obrazovka bez lišty prohlížeče, barva úvodní obrazovky.
 * Odkaz na něj vloží Next.js do každé stránky sám.
 *
 * Ikony jsou hotové obrázky v public/icons (192 a 512 px; „maskable“ má
 * značku menší uprostřed, aby ji Android mohl oříznout do kolečka nebo
 * zaobleného čtverce). Na iPhonu se bere app/apple-icon.tsx.
 *
 * Anglicky - web je v základu anglicky a jméno appky je stejně „Kine“.
 * Zkratky (dlouhé podržení ikony na Androidu): Sparks, Živě, Prozkoumat, Nahrát.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Kine',
    short_name: 'Kine',
    description: 'Videos, Sparks and live streams - watch, create and share on Kine.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#050506',
    theme_color: '#050506',
    categories: ['entertainment', 'video', 'social'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/kine-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/kine-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/kine-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/kine-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Sparks', url: '/sparks', icons: [{ src: '/icons/kine-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Live', url: '/live', icons: [{ src: '/icons/kine-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Explore', url: '/explore', icons: [{ src: '/icons/kine-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Upload', url: '/upload', icons: [{ src: '/icons/kine-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
