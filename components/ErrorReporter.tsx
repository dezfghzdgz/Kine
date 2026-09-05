'use client';

import { useEffect } from 'react';
import { installErrorReporter } from '@/lib/errorReporter';

/**
 * Zapne hlášení chyb z prohlížeče (lib/errorReporter.ts). Sedí v kostře
 * appky (app/layout.tsx), takže běží na každé stránce a přežije přechody
 * mezi nimi. Nic nevykresluje.
 */
export default function ErrorReporter() {
  useEffect(() => installErrorReporter(), []);
  return null;
}
