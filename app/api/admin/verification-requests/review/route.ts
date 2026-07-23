import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

async function requireAdmin(req: NextRequest) {
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

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) {
    return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  }

  const { requestId, action, tier } = await req.json();

  const { data: request } = await supabaseServer
    .from('verification_requests')
    .select('user_id')
    .eq('id', requestId)
    .single();

  if (!request) {
    return NextResponse.json({ error: 'Žádost nenalezena.' }, { status: 404 });
  }

  await supabaseServer
    .from('verification_requests')
    .update({ status: action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', requestId);

  if (action === 'approve') {
    await supabaseServer
      .from('profiles')
      .update({ verification_tier: tier ?? 'basic' })
      .eq('id', request.user_id);

    await supabaseServer.from('notifications').insert({
      user_id: request.user_id,
      message: 'Tvoje žádost o ověření byla schválena! 🎉',
      link: '/channel-stats',
    });
  } else {
    await supabaseServer.from('notifications').insert({
      user_id: request.user_id,
      message: 'Tvoje žádost o ověření byla zamítnuta.',
      link: '/channel-stats',
    });
  }

  return NextResponse.json({ success: true });
}
