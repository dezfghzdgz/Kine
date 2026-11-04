import { permanentRedirect } from 'next/navigation';

/**
 * Stará adresa seznamu podporovatelů (dřív "fans") - přesměruje na
 * playkine.com/supporters, ať fungují i starší odkazy z reklam.
 */
export default function FansRedirect(): never {
  permanentRedirect('/supporters');
}
