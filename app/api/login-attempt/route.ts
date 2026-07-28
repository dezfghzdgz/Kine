import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAX_REQUESTS_PER_IP_PER_HOUR = 20;

// Tenhle endpoint appka volá kolem přihlašování - drží si počet
// neúspěšných pokusů podle emailu a po 5 chybách účet na 15 minut
// dočasně uzamkne (bez ohledu na to, jestli má uživatel 2FA nebo ne).
//
// Appka tady navíc hlídá i to, kolikrát se sem ozvala STEJNÁ adresa (IP)
// za hodinu - bez tohohle by šlo appku klidně zavolat přímo (bez appky
// hesla) a někoho tak uzamknout jen podle jeho emailu.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count: ipRequestCount } = await supabaseServer
    .from('login_attempt_ip_log')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .gte('created_at', hourAgo);

  if ((ipRequestCount ?? 0) >= MAX_REQUESTS_PER_IP_PER_HOUR) {
    return NextResponse.json({ error: 'Příliš mnoho pokusů z tvojí adresy. Zkus to prosím později.' }, { status: 429 });
  }

  await supabaseServer.from('login_attempt_ip_log').insert({ ip_address: ip });

  const { email, action } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Chybí email.' }, { status: 400 });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const { data: existing } = await supabaseServer
    .from('login_lockouts')
    .select('failed_count, locked_until')
    .eq('email', normalizedEmail)
    .maybeSingle();

  const now = new Date();
  const isCurrentlyLocked = existing?.locked_until && new Date(existing.locked_until) > now;

  if (action === 'check') {
    return NextResponse.json({
      locked: !!isCurrentlyLocked,
      lockedUntil: isCurrentlyLocked ? existing!.locked_until : null,
    });
  }

  if (action === 'reset') {
    await supabaseServer
      .from('login_lockouts')
      .upsert({ email: normalizedEmail, failed_count: 0, locked_until: null, updated_at: now.toISOString() });
    return NextResponse.json({ ok: true });
  }

  if (action === 'record-failure') {
    // Pokud je zámek už aktivní, jen ho potvrdíme - nezvyšujeme počítadlo donekonečna.
    if (isCurrentlyLocked) {
      return NextResponse.json({ locked: true, lockedUntil: existing!.locked_until });
    }

    const nextCount = (existing?.failed_count ?? 0) + 1;
    const shouldLock = nextCount >= MAX_ATTEMPTS;
    const lockedUntil = shouldLock
      ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;

    await supabaseServer
      .from('login_lockouts')
      .upsert({
        email: normalizedEmail,
        failed_count: shouldLock ? 0 : nextCount,
        locked_until: lockedUntil,
        updated_at: now.toISOString(),
      });

    return NextResponse.json({ locked: shouldLock, lockedUntil, attemptsLeft: Math.max(0, MAX_ATTEMPTS - nextCount) });
  }

  return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400 });
}
