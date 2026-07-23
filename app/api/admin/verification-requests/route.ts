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

  const { data: requests } = await supabaseServer
    .from('verification_requests')
    .select('id, user_id, subscriber_count_at_request, status, created_at, profiles!verification_requests_user_id_fkey(username, display_name)')
    .order('created_at', { ascending: false });

  return NextResponse.json({ requests: requests ?? [] });
}
