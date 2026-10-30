import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { deleteStreamVideo, isCloudflareUid, processCloudflareCleanup, queueCloudflareDelete } from '@/lib/cloudflareVideos';
import { deleteLiveInput } from '@/lib/liveStream';
import { cancelStripeSubscriptionsOf } from '@/lib/stripeCancel';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Trvale smaže účet: nejdřív přihlašovací účet (díky "on delete cascade" se
 * tím smaže i všechno v databázi - videa, komentáře, playlisty, příspěvky...),
 * pak soubory u Cloudflare: videa, nedokončená nahrávání a vstup pro
 * vysílání (dřív zůstal - šlo by do něj vysílat dál a záznamy by se platily).
 *
 * Videa se mažou přes frontu (cloudflare_cleanup): kanál se stovkami videí
 * by se za minutu, kterou má server na odpověď, smazat nestihl. Co nestihne
 * teď, dodělá úklid.
 *
 * Úplně napřed se zruší předplatná u Stripe (lib/stripeCancel.ts) - dřív se
 * po smazání účtu z karty strhávalo dál. Když zrušení selže, účet se nesmaže
 * (jinak by člověk platil za smazaný účet a neměl jak to zrušit).
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const userId = userData.user.id;

  const cancel = await cancelStripeSubscriptionsOf(userId);
  if (!cancel.ok) {
    return NextResponse.json(
      {
        error: 'Předplatné u Stripe se nepodařilo zrušit, účet proto zatím zůstává. Zkus to za chvíli znovu, nebo napiš na kinesupport@gmail.com.',
        code: 'subscription-cancel-failed',
      },
      { status: 502 }
    );
  }

  const [{ data: videos }, tickets, input] = await Promise.all([
    supabaseServer.from('videos').select('cloudflare_video_id').eq('owner_id', userId).limit(10000),
    supabaseServer.from('upload_tickets').select('cf_uid').eq('user_id', userId).eq('status', 'pending'),
    supabaseServer.from('live_inputs').select('cf_input_id').eq('owner_id', userId).maybeSingle(),
  ]);
  const uids = new Set<string>();
  for (const v of (videos ?? []) as { cloudflare_video_id: string | null }[]) if (isCloudflareUid(v.cloudflare_video_id)) uids.add(v.cloudflare_video_id);
  for (const t of ((tickets.data ?? []) as { cf_uid: string }[])) if (isCloudflareUid(t.cf_uid)) uids.add(t.cf_uid);
  const inputId = (input.data as { cf_input_id?: string | null } | null)?.cf_input_id ?? null;

  const { error: deleteError } = await supabaseServer.auth.admin.deleteUser(userId);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  if (inputId) await deleteLiveInput(inputId);

  let queued = 0;
  for (const uid of uids) if (await queueCloudflareDelete(uid, 'smazaný účet', 0)) queued += 1;
  if (queued > 0) {
    await processCloudflareCleanup(25);
  } else {
    // Fronta není (migrace neproběhla): rovnou, jako dřív.
    await Promise.all([...uids].slice(0, 200).map((uid) => deleteStreamVideo(uid)));
  }

  return NextResponse.json({ success: true });
}
