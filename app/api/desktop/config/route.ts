import { NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/linkPreview';
import { enforcedDesktopMinVersion } from '@/lib/desktopGate';

/**
 * Konfigurace pro appku Kine do PC (kine-desktop).
 *
 * Appka nemá nic zadrátovaného: při startu si odsud vezme adresu
 * Supabase a veřejný "anon" klíč - ten samý, který má každý návštěvník
 * webu v JavaScriptu, žádné tajemství. Díky tomu se dá appka přepnout
 * na jinou instalaci Kine (vývoj na localhostu) bez nové verze a klíče
 * jdou kdykoliv vyměnit na jednom místě.
 */
// Vždy živě - hodnoty se berou z prostředí serveru, ne z doby sestavení.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase není nakonfigurovaná.' }, { status: 500 });
  }
  return NextResponse.json(
    {
      supabaseUrl,
      supabaseAnonKey,
      siteUrl: SITE_URL,
      // Nejstarší verze appky, která smí na Kine nahrávat a vysílat (lib/desktopGate.ts) -
      // jen když je požadovaná verze už vydaná. Appka od 0.11.0 podle toho sama
      // řekne "aktualizuj" (starší verze hodnotu ignorují, odmítne je server).
      minDesktopVersion: (await enforcedDesktopMinVersion()) ?? '0.1.0',
    },
    {
      headers: { 'Access-Control-Allow-Origin': '*' },
    }
  );
}
