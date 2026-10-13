import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isStaffUser, userFromRequest } from '@/lib/apiUser';
import { cloudflareLiveListing, inputSeen, liveConfigured, streamCustomerCode, type LiveStreamRow } from '@/lib/liveStream';
import { appPingFresh, appSignalTrusted, decideLive } from '@/lib/liveSignal';
import { liveHiddenNow } from '@/lib/nudityRules';
import { secondsSince } from '@/lib/liveEvents';

export const dynamic = 'force-dynamic';

/**
 * Diagnostika živého vysílání pro tým Kine (/admin/live): co si server
 * o každém přenosu myslí a proč. Databáze (živě? kdy hlásila appka, kdy
 * potvrdil Cloudflare), Cloudflare teď (seznam běžících, lifecycle vstupu),
 * jestli přenos vidí ostatní (a když ne, proč) a deník událostí (začal,
 * potvrzen, skončil - s důvodem; lib/liveEvents.ts). Nic nemění, jen čte.
 */

type Visibility = 'public' | 'offline' | 'moderation' | 'shadow-ban' | 'banned' | 'no-profile';

/** Vidí přenos ostatní (nepřihlášený divák, běžný účet)? Když ne, proč - stejná pravidla jako app/api/live/now. */
function visibilityOf(row: LiveStreamRow, profile: { is_banned?: boolean | null; is_shadow_banned?: boolean | null } | undefined): Visibility {
  if (!profile) return 'no-profile';
  if (profile.is_banned) return 'banned';
  if (profile.is_shadow_banned) return 'shadow-ban';
  if (!row.is_live) return 'offline';
  if (liveHiddenNow(row as any)) return 'moderation';
  return 'public';
}

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user || !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: 'Jen pro tým Kine (moderátoři a správci).' }, { status: 403 });
  }

  const now = Date.now();
  const since = new Date(now - 6 * 3600 * 1000).toISOString();
  const listing = await cloudflareLiveListing();
  const listedInputs = [...listing.byInput.keys()].filter((id) => /^[a-z0-9]+$/i.test(id));
  const filter = [`is_live.eq.true`, `updated_at.gte.${since}`, ...(listedInputs.length > 0 ? [`cf_input_id.in.(${listedInputs.map((id) => `"${id}"`).join(',')})`] : [])].join(',');
  const { data, error } = await supabaseServer.from('live_streams').select('*').or(filter).order('updated_at', { ascending: false }).limit(40);
  if (error) return NextResponse.json({ error: `Databáze: ${error.message}` }, { status: 500 });
  const rows = (data ?? []) as LiveStreamRow[];

  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const { data: eventsRaw } = await supabaseServer
    .from('client_errors')
    .select('created_at, user_id, message, stack')
    .eq('kind', 'live')
    .order('created_at', { ascending: false })
    .limit(120);
  const events = (eventsRaw ?? []) as { created_at: string; user_id: string | null; message: string; stack: string | null }[];
  for (const e of events) if (e.user_id && !ownerIds.includes(e.user_id)) ownerIds.push(e.user_id);

  const profiles = new Map<string, { username: string | null; display_name: string | null; is_banned?: boolean | null; is_shadow_banned?: boolean | null }>();
  if (ownerIds.length > 0) {
    const full = await supabaseServer.from('profiles').select('id, username, display_name, is_banned, is_shadow_banned').in('id', ownerIds);
    const list = full.error ? (await supabaseServer.from('profiles').select('id, username, display_name').in('id', ownerIds)).data : full.data;
    for (const p of (list ?? []) as any[]) profiles.set(p.id, p);
  }

  const channels = await Promise.all(
    rows.map(async (row) => {
      const video = listing.byInput.get(row.cf_input_id) ?? null;
      const seen = row.cf_input_id ? await inputSeen(row.cf_input_id).catch(() => ({ live: null, videoUid: null })) : { live: null, videoUid: null };
      const profile = profiles.get(row.owner_id);
      const decision = decideLive(row as any, { listed: !!video, connected: seen.live, videoCreatedAt: video?.created ?? null }, now);
      const confirmedIso = row.cf_confirmed_at !== undefined ? row.cf_confirmed_at ?? null : row.checked_at;
      return {
        ownerId: row.owner_id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? null,
        isLive: row.is_live,
        title: row.title,
        visibility: visibilityOf(row, profile),
        startedAgoS: secondsSince(row.started_at, now),
        endedAgoS: secondsSince(row.ended_at, now),
        updatedAgoS: secondsSince((row as any).updated_at, now),
        appPingAgoS: secondsSince(row.app_ping_at, now),
        appPingFresh: appPingFresh(row as any, now),
        appTrusted: appSignalTrusted(row as any, now),
        cfConfirmedAgoS: secondsSince(confirmedIso, now),
        videoUid: row.current_video_uid,
        inputId: row.cf_input_id,
        cloudflare: { listed: !!video, listedVideo: video?.uid ?? null, receiving: seen.live, lifecycleVideo: seen.videoUid },
        decision,
        moderation: {
          hiddenAgoS: secondsSince((row as any).moderation_hidden_at, now),
          hiddenNow: liveHiddenNow(row as any),
          strikes: Array.isArray((row as any).moderation_strikes) ? (row as any).moderation_strikes.length : 0,
        },
      };
    })
  );

  const sample = rows[0] as Record<string, unknown> | undefined;
  const has = (column: string) => (sample ? Object.prototype.hasOwnProperty.call(sample, column) : null);

  return NextResponse.json(
    {
      now: new Date(now).toISOString(),
      cloudflare: {
        configured: liveConfigured(),
        ok: listing.ok,
        error: listing.error,
        listed: listing.byInput.size,
        customerCode: await streamCustomerCode(),
      },
      // Sloupce z migrací (null = nevíme, žádný přenos v databázi).
      columns: { app_ping_at: has('app_ping_at'), cf_confirmed_at: has('cf_confirmed_at'), moderation_hidden_at: has('moderation_hidden_at') },
      channels,
      events: events.map((e) => ({
        at: e.created_at,
        ownerId: e.user_id,
        username: e.user_id ? profiles.get(e.user_id)?.username ?? null : null,
        message: e.message,
        details: e.stack,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
