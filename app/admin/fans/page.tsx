import { redirect } from 'next/navigation';

/** Stará adresa správy podporovatelů (dřív "fans") - teď /admin/supporters. */
export default function AdminFansRedirect(): never {
  redirect('/admin/supporters');
}
