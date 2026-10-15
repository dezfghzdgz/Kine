import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { validChatColor } from '@/lib/chatEmotes';

export const dynamic = 'force-dynamic';

const NEEDS_MIGRATION = 'Barva jména potřebuje migraci supabase-migration-chat-emoty.sql.';

function missingColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || /chat_color/i.test(error.message ?? ''));
}

/** Moje barva jména v chatu: GET ji vrátí, POST { color: "#rrggbb" | null } nastaví (null = výchozí podle účtu). */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data, error } = await supabaseServer.from('profiles').select('chat_color').eq('id', user.id).maybeSingle();
  if (missingColumn(error)) return NextResponse.json({ color: null, available: false }, { headers: { 'Cache-Control': 'no-store' } });
  const color = (data as { chat_color?: string | null } | null)?.chat_color ?? null;
  return NextResponse.json({ color: validChatColor(color) ? color : null, available: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const color = body?.color === null ? null : String(body?.color ?? '').toLowerCase();
  if (color !== null && !validChatColor(color)) return NextResponse.json({ error: 'Barva musí být ve tvaru #rrggbb.' }, { status: 400 });
  const { error } = await supabaseServer.from('profiles').update({ chat_color: color }).eq('id', user.id);
  if (missingColumn(error)) return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ color }, { headers: { 'Cache-Control': 'no-store' } });
}
