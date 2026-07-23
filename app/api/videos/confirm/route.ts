import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Poté, co prohlížeč dokončí upload videa přímo do Cloudflare,
// zavolá tenhle endpoint, aby se video zapsalo do naší databáze.
export async function POST(req: NextRequest) {
  // Přihlašovací token posílá appka v hlavičce Authorization (viz upload/page.tsx).
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);

  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const {
    title, description, cloudflareVideoId, madeForKids, hasPaidPromotion, isAiGenerated,
    language, category, visibility, isPremiere, scheduledAt, width, height, chapters, captions, hashtags,
  } = await req.json();

  if (!title || !cloudflareVideoId) {
    return NextResponse.json({ error: 'Chybí název videa nebo ID.' }, { status: 400 });
  }

  if (title.length > 150) {
    return NextResponse.json({ error: 'Název videa je příliš dlouhý (max 150 znaků).' }, { status: 400 });
  }

  if (description && description.length > 5000) {
    return NextResponse.json({ error: 'Popis je příliš dlouhý (max 5000 znaků).' }, { status: 400 });
  }

  // Denní limit nahrávání (zatím 5/den, ať se appka nedá zahltit) -
  // časem to jde uvolnit, jakmile appka pozná i jiné signály důvěry.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentUploadCount } = await supabaseServer
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', userData.user.id)
    .gte('created_at', since24h);

  if ((recentUploadCount ?? 0) >= 5) {
    return NextResponse.json(
      { error: 'Dosáhl/a jsi denního limitu 5 nahraných videí. Zkus to prosím zítra.' },
      { status: 429 }
    );
  }

  const { data, error } = await supabaseServer
    .from('videos')
    .insert({
      owner_id: userData.user.id,
      title,
      description,
      cloudflare_video_id: cloudflareVideoId,
      status: 'processing',
      made_for_kids: madeForKids ?? false,
      has_paid_promotion: hasPaidPromotion ?? false,
      is_ai_generated: isAiGenerated ?? false,
      language: language ?? 'cs',
      category: category ?? null,
      visibility: visibility ?? 'public',
      is_premiere: isPremiere ?? false,
      scheduled_at: scheduledAt || null,
      width: width ?? null,
      height: height ?? null,
      chapters: chapters ?? [],
      captions: captions ?? [],
      hashtags: hashtags ?? [],
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pokud je video hned veřejně publikované (ne naplánované na později),
  // dáme vědět všem odběratelům tohohle kanálu.
  const isImmediatelyPublic =
    (visibility ?? 'public') === 'public' && (!scheduledAt || new Date(scheduledAt) <= new Date());

  if (isImmediatelyPublic) {
    const { data: subs } = await supabaseServer
      .from('subscriptions')
      .select('subscriber_id')
      .eq('channel_id', userData.user.id);

    if (subs && subs.length > 0) {
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('username, display_name')
        .eq('id', userData.user.id)
        .single();
      const name = profile?.display_name ?? profile?.username ?? 'Tvůrce, kterého sleduješ';

      await supabaseServer.from('notifications').insert(
        subs.map((s) => ({
          user_id: s.subscriber_id,
          message: `${name} nahrál/a nové video: ${title}`,
          link: `/watch/${data.id}`,
        }))
      );
    }
  }

  return NextResponse.json({ video: data });
}
