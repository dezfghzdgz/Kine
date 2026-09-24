import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { shouldBeProtected, syncVideoProtection } from '@/lib/streamProtection';
import { hasKinePlus, KINE_PLUS_UPLOAD_MULTIPLIER } from '@/lib/plus';
import { sweepProcessing } from '@/lib/markVideoReady';
import { sanitizeCaptions, sanitizeChapters } from '@/lib/captions';

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

  // Denní limit nahrávání, ať se appka nedá zahltit. Dřív natvrdo 5 - to
  // je málo pro tvůrce, který si přenáší kanál (viz hromadné nahrání).
  // Nastavuje se proměnnou UPLOAD_DAILY_LIMIT na Vercelu, výchozí 20;
  // s Kine Plus (lib/plus.ts) je limit 3x vyšší.
  // Klipy (videos.clipped_from_video_id) se do limitu nepočítají - vlastní
  // je tvůrce původního videa, ale vystřihují je diváci.
  const baseLimit = Math.max(1, Number(process.env.UPLOAD_DAILY_LIMIT) || 20);
  let dailyLimit = baseLimit;
  {
    const plan = await supabaseServer.from('profiles').select('plan, plan_until').eq('id', userData.user.id).maybeSingle();
    if (!plan.error && hasKinePlus(plan.data?.plan, plan.data?.plan_until)) dailyLimit = baseLimit * KINE_PLUS_UPLOAD_MULTIPLIER;
  }
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let recentUploadCount = 0;
  {
    const withoutClips = await supabaseServer
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userData.user.id)
      .is('clipped_from_video_id', null)
      .gte('created_at', since24h);
    if (!withoutClips.error) {
      recentUploadCount = withoutClips.count ?? 0;
    } else {
      // Sloupec klipů ještě není (migrace neproběhla) - počítá se všechno.
      const all = await supabaseServer
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', userData.user.id)
        .gte('created_at', since24h);
      recentUploadCount = all.count ?? 0;
    }
  }

  if (recentUploadCount >= dailyLimit) {
    return NextResponse.json(
      { error: `Dosáhl/a jsi denního limitu ${dailyLimit} nahraných videí. Zkus to prosím zítra.` },
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
      // Od klienta (web, appka) se bere jen to, co dává smysl - rozbité kapitoly by shodily stránku videa.
      chapters: sanitizeChapters(chapters),
      captions: sanitizeCaptions(captions),
      hashtags: hashtags ?? [],
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Neveřejné video dostane u Cloudflare podepsané adresy hned, ať se
  // nedá pustit podle id ani chvíli (lib/streamProtection.ts; bez
  // nastaveného klíče nic nedělá). Kdyby to teď nevyšlo, srovná se to
  // znovu po zpracování videa a po každém uložení úprav.
  if (shouldBeProtected(visibility)) {
    await syncVideoProtection(data.id);
  }

  // Odběratelům se tady nic neposílá: video se ještě zpracovává (odkaz by
  // vedl na "zpracovává se") a oznámení pošle markVideoReady, až bude hotové
  // - jednou, jen těm se zapnutým zvonečkem, a u naplánovaného videa až
  // v čase zveřejnění. Dřív šlo oznámení odsud i odtamtud, tedy dvakrát.

  // Nové nahrání = tvůrce je aktivní; při té příležitosti se dodělají
  // jeho (i cizí) dřívější videa, která zůstala viset jako "processing".
  await sweepProcessing();

  return NextResponse.json({ video: data });
}
