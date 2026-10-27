import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { shouldBeProtected, syncVideoProtection } from '@/lib/streamProtection';
import { sweepProcessing } from '@/lib/markVideoReady';
import { runInBackground } from '@/lib/background';
import { sanitizeCaptions, sanitizeChapters } from '@/lib/captions';
import { isCloudflareUid } from '@/lib/cloudflareVideos';
import { attachVideoToTicket, claimTicket, legacyUploadAllowed, limitsForProfile, uploadProfile, uploadUsage } from '@/lib/uploadTickets';
import { outdatedAppResponse } from '@/lib/desktopGate';
import { normalizeCategory } from '@/lib/categories';

export const dynamic = 'force-dynamic';
// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

const VISIBILITIES = new Set(['public', 'subscribers', 'private']);

/**
 * Poté, co prohlížeč (nebo appka do PC) dokončí nahrání videa přímo do
 * Cloudflare, zavolá tenhle endpoint, aby se video zapsalo do naší databáze.
 *
 * Video se uloží jen s lístkem z /api/videos/create-upload-url
 * (lib/uploadTickets.ts) - id u Cloudflare tedy nejde podstrčit cizí.
 * Opakované potvrzení (appka po výpadku sítě) vrátí už uložené video.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const userId = userData.user.id;

  const outdated = await outdatedAppResponse(req);
  if (outdated) return outdated;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  const {
    title, description, cloudflareVideoId, madeForKids, hasPaidPromotion, isAiGenerated, isArtistic,
    language, category, visibility, isPremiere, scheduledAt, width, height, chapters, captions, hashtags,
  } = body as Record<string, any>;

  if (typeof title !== 'string' || !title.trim() || !cloudflareVideoId) {
    return NextResponse.json({ error: 'Chybí název videa nebo ID.' }, { status: 400 });
  }
  if (!isCloudflareUid(cloudflareVideoId)) {
    return NextResponse.json({ error: 'Neplatné ID videa.' }, { status: 400 });
  }
  if (title.length > 150) {
    return NextResponse.json({ error: 'Název videa je příliš dlouhý (max 150 znaků).' }, { status: 400 });
  }
  if (description != null && (typeof description !== 'string' || description.length > 5000)) {
    return NextResponse.json({ error: 'Popis je příliš dlouhý (max 5000 znaků).' }, { status: 400 });
  }

  const profile = await uploadProfile(userId);
  if (!profile) return NextResponse.json({ error: 'Profil nenalezen.' }, { status: 403 });
  if (profile.is_banned) return NextResponse.json({ error: 'Účet je zablokovaný.', code: 'banned' }, { status: 403 });

  // Už uložené (opakované potvrzení)? Vrátí se totéž video, nic nového nevznikne.
  const existing = await existingVideo(cloudflareVideoId);
  if (existing) {
    if (existing.owner_id !== userId) return NextResponse.json({ error: 'Tohle video patří někomu jinému.' }, { status: 403 });
    return NextResponse.json({ video: existing, alreadySaved: true });
  }

  const claim = await claimTicket(userId, cloudflareVideoId);
  let ticketId: string | null = null;
  if (claim.kind === 'claimed') {
    ticketId = claim.ticketId;
  } else if (claim.kind === 'already') {
    // Lístek už je uplatněný, ale video chybí (minule spadl zápis) - zkusí se znovu.
    ticketId = claim.ticketId;
  } else if (claim.kind === 'other-user') {
    return NextResponse.json({ error: 'Tohle nahrání patří někomu jinému.' }, { status: 403 });
  } else if (claim.kind === 'expired') {
    return NextResponse.json({ error: 'Nahrání vypršelo - nahraj video prosím znovu.', code: 'expired' }, { status: 410 });
  } else if (claim.kind === 'error') {
    return NextResponse.json({ error: claim.message }, { status: 500 });
  } else {
    // Bez lístku: tabulka ještě není (migrace), nebo nahrávání začalo před nasazením téhle verze.
    const allowed = await legacyUploadAllowed(userId, cloudflareVideoId);
    if (!allowed.ok) return NextResponse.json({ error: allowed.message, code: 'no-ticket' }, { status: 403 });
    if (claim.kind === 'no-table') {
      // Starý denní limit (počet videí za 24 hodin) - nový hlídá už vydání adresy.
      const limits = limitsForProfile(profile, userData.user.created_at ?? null);
      const { usage } = await uploadUsage(userId);
      if (usage.uploadsToday >= limits.perDay) {
        return NextResponse.json({ error: `Dosáhl/a jsi denního limitu ${limits.perDay} nahraných videí. Zkus to prosím zítra.`, code: 'daily-count' }, { status: 429 });
      }
    }
  }

  const row: Record<string, unknown> = {
    owner_id: userId,
    title: title.trim(),
    description: typeof description === 'string' ? description : null,
    cloudflare_video_id: cloudflareVideoId,
    status: 'processing',
    made_for_kids: madeForKids === true,
    has_paid_promotion: hasPaidPromotion === true,
    is_ai_generated: isAiGenerated === true,
    language: typeof language === 'string' && language.length <= 12 ? language : 'cs',
    // Klíč kategorie ('catGaming'); "gaming" z mobilní appky se převede, neznámé = bez kategorie.
    category: normalizeCategory(category),
    visibility: VISIBILITIES.has(visibility) ? visibility : 'public',
    is_premiere: isPremiere === true,
    scheduled_at: typeof scheduledAt === 'string' && Number.isFinite(Date.parse(scheduledAt)) ? scheduledAt : null,
    width: Number.isFinite(width) && width > 0 && width < 20000 ? Math.round(width) : null,
    height: Number.isFinite(height) && height > 0 && height < 20000 ? Math.round(height) : null,
    // Od klienta (web, appka) se bere jen to, co dává smysl - rozbité kapitoly by shodily stránku videa.
    chapters: sanitizeChapters(chapters),
    captions: sanitizeCaptions(captions),
    hashtags: Array.isArray(hashtags)
      ? hashtags.filter((h: unknown): h is string => typeof h === 'string').map((h) => h.trim().slice(0, 50)).filter(Boolean).slice(0, 30)
      : [],
  };
  // Umělecká nahota (automatická kontrola takové video neskryje, jen ho pošle
  // ke kontrole) - sloupec je až s migrací podpory-kontrola; bez ní se vynechá.
  if (isArtistic === true) row.artistic = true;
  let { data, error } = await supabaseServer.from('videos').insert(row).select().single();
  if (error && row.artistic && /artistic/i.test(error.message ?? '')) {
    delete row.artistic;
    ({ data, error } = await supabaseServer.from('videos').insert(row).select().single());
  }

  if (error || !data) {
    // Souběžné potvrzení (dvakrát rychle za sebou) - vrátit to, co uložilo to první.
    const raced = await existingVideo(cloudflareVideoId);
    if (raced && raced.owner_id === userId) return NextResponse.json({ video: raced, alreadySaved: true });
    return NextResponse.json({ error: error?.message ?? 'Video se nepodařilo uložit.' }, { status: 500 });
  }

  if (ticketId) await attachVideoToTicket(ticketId, data.id);

  // Neveřejné video dostane u Cloudflare podepsané adresy hned, ať se
  // nedá pustit podle id ani chvíli (lib/streamProtection.ts; bez
  // nastaveného klíče nic nedělá). Kdyby to teď nevyšlo, srovná se to
  // znovu po zpracování videa a po každém uložení úprav.
  if (shouldBeProtected(row.visibility as string)) {
    await syncVideoProtection(data.id);
  }

  // Odběratelům se tady nic neposílá: video se ještě zpracovává a oznámení
  // pošle markVideoReady, až bude hotové - jednou, jen těm se zapnutým zvonečkem.

  // Nové nahrání = tvůrce je aktivní; při té příležitosti se dodělají
  // jeho (i cizí) dřívější videa, která zůstala viset jako "processing".
  // Na pozadí: úklid se může ptát Cloudflare na víc videí a appka by na potvrzení čekala
  // (při pomalém Cloudflare by vypršela a nahrála klip znovu - duplikát).
  runInBackground(sweepProcessing(), 'úklid zaseklých videí');

  return NextResponse.json({ video: data });
}

async function existingVideo(cloudflareVideoId: string): Promise<any | null> {
  const { data } = await supabaseServer.from('videos').select('*').eq('cloudflare_video_id', cloudflareVideoId).limit(1);
  return (data as any[] | null)?.[0] ?? null;
}
