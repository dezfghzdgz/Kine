import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Správa podílu tvůrce na výdělcích.
 *
 * Běží na serveru se service role, protože podíl je chráněný spouštěčem
 * v databázi - z prohlížeče ho nezmění nikdo, ani sám tvůrce. Sáhnout na
 * něj smí jen administrátor.
 *
 * GET  - seznam tvůrců s jejich podílem (volitelně vyhledávání)
 * POST - nastavení podílu, stavu partnerství a poznámky
 */

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return null;

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .single();

  return profile?.is_admin ? userData.user.id : null;
}

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });

  const search = req.nextUrl.searchParams.get('search')?.trim() ?? '';

  let query = supabaseServer
    .from('profiles')
    .select('id, username, display_name, avatar_url, revenue_share_percent, partner_status, revenue_share_note, revenue_share_manual')
    .order('username', { ascending: true })
    .limit(50);

  if (search) query = query.ilike('username', `%${search}%`);

  const { data: creators, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Počty odběratelů k jednotlivým tvůrcům - podle nich se pozná, jestli
  // už mají nárok na vyšší stupeň.
  // Počet přes count pro každého tvůrce zvlášť. Dřív se stahovaly řádky
  // odběrů pro všechny najednou a počítaly v paměti - databáze ale vrátí
  // nejvíc 1000 řádků, takže od tisíce odběrů dohromady byly stupně špatně.
  const ids = (creators ?? []).map((c: any) => c.id);
  const subscriberCounts: Record<string, number> = {};

  await Promise.all(
    ids.map(async (id: string) => {
      const { count } = await supabaseServer
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', id);
      subscriberCounts[id] = count ?? 0;
    })
  );

  return NextResponse.json({
    creators: (creators ?? []).map((c: any) => ({
      ...c,
      subscriberCount: subscriberCounts[c.id] ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });

  const { creatorId, percent, partnerStatus, note, resetToAutomatic } = await req.json();
  if (!creatorId) return NextResponse.json({ error: 'Chybí creatorId.' }, { status: 400 });

  // Vrácení na automatický podíl podle počtu odběratelů.
  if (resetToAutomatic) {
    const { error: resetError } = await supabaseServer
      .from('profiles')
      .update({ revenue_share_manual: false, partner_status: 'standard', revenue_share_note: null })
      .eq('id', creatorId);

    if (resetError) return NextResponse.json({ error: resetError.message }, { status: 400 });
    return NextResponse.json({ ok: true, resetToAutomatic: true });
  }

  // Schválně žádné Number(): prázdné pole i null by se z něj vyklubaly jako
  // nula a tvůrci by se tiše srazil podíl na 0 %.
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 0 || percent > 100) {
    return NextResponse.json({ error: 'Podíl musí být celé číslo od 0 do 100.' }, { status: 400 });
  }
  const parsedPercent = percent;

  const allowedStatuses = ['standard', 'partner', 'sanctioned'];
  if (partnerStatus && !allowedStatuses.includes(partnerStatus)) {
    return NextResponse.json({ error: 'Neznámý stav partnerství.' }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from('profiles')
    .update({
      revenue_share_percent: parsedPercent,
      partner_status: partnerStatus ?? 'standard',
      revenue_share_note: typeof note === 'string' ? note.slice(0, 300) : null,
      // Od téhle chvíle platí číslo od moderátora, ne automatický stupeň.
      revenue_share_manual: true,
    })
    .eq('id', creatorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Tvůrce se o změně dozví - u sankce i u povýšení.
  await supabaseServer.from('notifications').insert({
    user_id: creatorId,
    type: partnerStatus === 'sanctioned' ? 'moderation_warning' : 'default',
    message: `Tvůj podíl z výdělků je nově ${parsedPercent} % (Kine ${100 - parsedPercent} %).`,
    link: '/channel-stats',
  });

  return NextResponse.json({ ok: true });
}
