import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { clientIp } from '@/lib/clientIp';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAX_REQUESTS_PER_IP_PER_HOUR = 20;

/**
 * Klíč zámku: e-mail + adresa, ze které se kdo přihlašuje.
 *
 * Dřív se zamykal jen e-mail. Endpoint je veřejný, takže kdokoli mohl
 * pětkrát poslat "record-failure" s cizím e-mailem a zamknout tak jeho
 * majitele na čtvrt hodiny - pořád dokola. Teď se zamkne jen ten, kdo
 * hádá heslo, a jen na svém připojení; skutečný majitel se odjinud
 * přihlásí normálně. Adresa se ukládá jen jako otisk.
 */
function lockKey(email: string, ip: string): string {
  return `${email}#${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`;
}

// Tenhle endpoint appka volá kolem přihlašování - drží si počet
// neúspěšných pokusů a po 5 chybách přihlašování z dané adresy na 15
// minut dočasně uzamkne (bez ohledu na to, jestli má uživatel 2FA nebo ne).
//
// Appka tady navíc hlídá i to, kolikrát se sem ozvala STEJNÁ adresa (IP)
// za hodinu. IP bere od Vercelu (lib/clientIp.ts) - hlavičku
// x-forwarded-for si klient může poslat vlastní.
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
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

  const body = await req.json().catch(() => ({}));
  const email = body?.email;
  const action = body?.action;

  if (!email || typeof email !== 'string' || email.length > 320) {
    return NextResponse.json({ error: 'Chybí email.' }, { status: 400 });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const key = lockKey(normalizedEmail, ip);

  const { data: existing } = await supabaseServer
    .from('login_lockouts')
    .select('failed_count, locked_until')
    .eq('email', key)
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
    // Vynulovat smí jen ten, kdo se právě opravdu přihlásil - jinak by si
    // útočník mezi pokusy počítadlo sám mazal.
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const { data: auth } = token ? await supabaseServer.auth.getUser(token) : { data: { user: null } };
    if (!auth.user || auth.user.email?.toLowerCase() !== normalizedEmail) {
      return NextResponse.json({ error: 'Nepřihlášený.' }, { status: 401 });
    }
    await supabaseServer.from('login_lockouts').delete().eq('email', key);
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
        email: key,
        failed_count: shouldLock ? 0 : nextCount,
        locked_until: lockedUntil,
        updated_at: now.toISOString(),
      });

    return NextResponse.json({ locked: shouldLock, lockedUntil, attemptsLeft: Math.max(0, MAX_ATTEMPTS - nextCount) });
  }

  return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400 });
}
