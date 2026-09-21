import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Připojení počítače: přihlášený uživatel (v prohlížeči) si vyžádá
 * jednorázový přihlašovací token pro appku Kine do PC.
 *
 * Proč ne prostě předat appce token z prohlížeče: obnovovací token
 * Supabase je jednorázový a točí se - kdyby ho měly obě strany, první
 * obnovení by tu druhou odhlásilo. Tady se přes admin API vyrobí
 * "magic link" (nic se neposílá e-mailem, jen se vezme jeho token_hash),
 * appka z něj udělá vlastní, nezávislou relaci. Token platí krátce
 * (výchozí hodina) a jen jednou.
 *
 * Stránka /connect ho pošle appce na http://127.0.0.1:<port>/link, nebo
 * přes odkaz kine://link?th=… - viz app/connect/page.tsx.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user?.email) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const { data, error } = await supabaseServer.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
  });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.json({ error: error?.message ?? 'Token se nepodařilo vytvořit.' }, { status: 500 });
  }

  return NextResponse.json({ token_hash: tokenHash });
}
