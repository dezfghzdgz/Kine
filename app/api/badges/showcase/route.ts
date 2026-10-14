import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { badgeStatsFor } from '@/lib/badgeCheck';
import { computeBadges, sanitizeShowcase } from '@/lib/badges';

export const dynamic = 'force-dynamic';

/** Chybí sloupec badge_showcase (migrace odznaků ještě neproběhla)? */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /badge_showcase/i.test(error.message ?? ''));
}

/**
 * Výběr odznaků na kanál (nejvýš 3, prázdný = schválně žádný). Ukládá server:
 * uloží jen odznaky, které uživatel opravdu má (i speciální a vlastní od týmu
 * Kine), a jen do vlastního profilu. Dřív ukládal prohlížeč přímo do tabulky
 * profiles a zápis se občas "nedal uložit".
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const wanted = sanitizeShowcase(body?.showcase);
  if (wanted === null) return NextResponse.json({ error: 'Chybí výběr odznaků.' }, { status: 400 });

  let next = wanted;
  if (wanted.length > 0) {
    const { data: profile, error } = await supabaseServer.from('profiles').select('created_at').eq('id', user.id).maybeSingle();
    if (error || !profile) return NextResponse.json({ error: 'Profil se teď nepodařilo načíst.' }, { status: 503 });
    const stats = await badgeStatsFor(user.id, (profile as { created_at?: string | null }).created_at ?? null);
    if (!stats) return NextResponse.json({ error: 'Odznaky se teď nepodařilo spočítat - zkus to za chvíli.' }, { status: 503 });
    const earned = new Set(computeBadges(stats).map((b) => b.id));
    next = wanted.filter((id) => earned.has(id));
  }

  const { error } = await supabaseServer.from('profiles').update({ badge_showcase: next }).eq('id', user.id);
  if (isMissingColumn(error)) {
    return NextResponse.json(
      { error: 'Výběr odznaků potřebuje v Supabase migraci supabase-migration-odznaky-vlastni.sql.', code: 'not-migrated' },
      { status: 503 }
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ showcase: next }, { headers: { 'Cache-Control': 'no-store' } });
}
