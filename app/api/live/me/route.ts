import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { appLiveSignal, createLiveInput, deleteLiveInput, liveConfigured, publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';
import { CATEGORY_KEYS } from '@/lib/categories';
import { parseRecordingVisibility } from '@/lib/liveRecording';
import { runInBackground } from '@/lib/background';
import { liveHiddenNow } from '@/lib/nudityRules';
import { liveMaxHours, recordingKeepDays, reenableIfCooledDown } from '@/lib/liveLimits';
import { outdatedAppResponse } from '@/lib/desktopGate';

export const dynamic = 'force-dynamic';
// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

/**
 * Studio živého vysílání (stránka /live): klíč pro OBS, název a popis
 * přenosu. Klíč je tajný - vydá se jen majiteli kanálu a jen odsud.
 */
async function loadSetup(ownerId: string) {
  const [input, stream] = await Promise.all([
    supabaseServer.from('live_inputs').select('*').eq('owner_id', ownerId).maybeSingle(),
    supabaseServer.from('live_streams').select('*').eq('owner_id', ownerId).maybeSingle(),
  ]);
  return { input, stream };
}

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  await syncLiveStreams();
  const { input, stream } = await loadSetup(user.id);
  if (isMissingTable(input.error) || isMissingTable(stream.error)) {
    return NextResponse.json({ configured: liveConfigured(), migrated: false, input: null, stream: null });
  }
  // Přestávka po moc dlouhém přenosu skončila - vstup se zapne hned (lib/liveLimits.ts).
  let disabled = input.data as { owner_id: string; cf_input_id: string | null; disabled_at?: string | null; disabled_reason?: string | null; disabled_until?: string | null } | null;
  if (disabled?.disabled_at && (await reenableIfCooledDown(disabled))) disabled = null;
  return NextResponse.json({
    configured: liveConfigured(),
    migrated: true,
    input: input.data
      ? { rtmpsUrl: input.data.rtmps_url, streamKey: input.data.stream_key, srtUrl: input.data.srt_url, createdAt: input.data.created_at }
      : null,
    stream: stream.data ? await publicLive(stream.data as LiveStreamRow) : null,
    // Běžící přenos skrytý kontrolou obsahu (čeká na moderátora) - studio to řekne naplno.
    moderation: { hidden: !!stream.data?.is_live && liveHiddenNow(stream.data as any) },
    // Co se záznamem po skončení (null = nechat ve studiu). Bez migrace sloupec chybí -> null.
    recordingVisibility: stream.data ? parseRecordingVisibility((stream.data as any).recording_visibility) : null,
    recordingAutoSupported: !!stream.data && Object.prototype.hasOwnProperty.call(stream.data, 'recording_visibility'),
    // Kolik dní zůstane nezveřejněný záznam (lib/liveLimits.ts).
    recordingKeepDays: recordingKeepDays(),
    // Vstup vypnutý (zablokovaný účet / přenos delší než strop) - studio řekne proč a do kdy.
    inputDisabled: disabled?.disabled_at
      ? { reason: disabled.disabled_reason ?? null, until: disabled.disabled_until ?? null, maxHours: liveMaxHours() }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');

  // Zastaralá appka do PC nezačne vysílat ani si nezaloží klíč (lib/desktopGate.ts);
  // běžící přenos ale dohlásí (ping / stopped) a název změní.
  if (action === 'started' || action === 'create' || action === 'reset') {
    const outdated = await outdatedAppResponse(req);
    if (outdated) return outdated;
  }

  // Appka (Kine Clipper) hlásí, že vysílá: hned se ukáže jako živé a dozví se, jestli ji Cloudflare vidí.
  if (action === 'started' || action === 'ping' || action === 'stopped') {
    // Zablokovaný účet nevysílá - ani pokračováním přenosu, který začal před zablokováním.
    if (action !== 'stopped') {
      const { data: profile } = await supabaseServer.from('profiles').select('is_banned').eq('id', user.id).maybeSingle();
      if (profile?.is_banned) {
        await appLiveSignal(user.id, 'stopped');
        return NextResponse.json({ error: 'Účet je zablokovaný.' }, { status: 403 });
      }
    }
    const result = await appLiveSignal(user.id, action);
    if (!result) return NextResponse.json({ error: 'Nejdřív si založ klíč pro vysílání.' }, { status: 404 });
    // Appka hlásí přenos pravidelně - snímek pro kontrolu obsahu se vezme i bez diváků.
    if (action !== 'stopped') runInBackground(import('@/lib/nudityScan').then((m) => m.scanLiveStreams()), 'kontrola obsahu přenosů');
    return NextResponse.json(
      {
        ok: true,
        confirmed: result.confirmed,
        migrated: result.migrated,
        viewers: result.viewers,
        recording: result.recording ?? null,
        // Po "stopped": id záznamu právě skončeného vysílání (appka: Stáhnout / Zahodit).
        recordingUid: result.recordingUid ?? null,
        // Přenos skrytý kontrolou obsahu (čeká na moderátora): appka nemá hlásit "vše v pořádku".
        hidden: result.hidden ? 'moderation' : null,
        // Je přenos teď na Kine živě a co o vstupu říká Cloudflare (appka to ukáže a zapíše do deníku).
        live: typeof result.live === 'boolean' ? result.live : null,
        cloudflare: result.cloudflare ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (action === 'details') {
    // Mění se jen to, co přišlo: appka posílá při startu název/popis/kategorii,
    // studio a záložka Živě zvlášť "co se záznamem po skončení".
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body?.title !== undefined) patch.title = String(body.title ?? '').trim().slice(0, 100);
    if (body?.description !== undefined) patch.description = String(body.description ?? '').trim().slice(0, 2000);
    if (body?.category !== undefined) {
      patch.category = typeof body.category === 'string' && (CATEGORY_KEYS as readonly string[]).includes(body.category) ? body.category : null;
    }
    const wantsRecording = body?.recordingVisibility !== undefined;
    if (wantsRecording) patch.recording_visibility = parseRecordingVisibility(body.recordingVisibility);
    let { data, error } = await supabaseServer.from('live_streams').update(patch).eq('owner_id', user.id).select('*').maybeSingle();
    let recordingAutoSupported = true;
    if (error && wantsRecording && /recording_visibility/.test(error.message ?? '')) {
      // Bez migrace supabase-migration-zive-2.sql: název a popis se uloží, automatické zveřejnění záznamu ne.
      recordingAutoSupported = false;
      const { recording_visibility: _drop, ...rest } = patch;
      ({ data, error } = await supabaseServer.from('live_streams').update(rest).eq('owner_id', user.id).select('*').maybeSingle());
    }
    if (error) return NextResponse.json({ error: error.message }, { status: isMissingTable(error) ? 503 : 500 });
    if (!data) return NextResponse.json({ error: 'Nejdřív si založ klíč pro vysílání.' }, { status: 404 });
    return NextResponse.json({
      stream: await publicLive(data as LiveStreamRow),
      recordingVisibility: parseRecordingVisibility((data as any).recording_visibility),
      recordingAutoSupported: recordingAutoSupported && Object.prototype.hasOwnProperty.call(data, 'recording_visibility'),
    });
  }

  if (action !== 'create' && action !== 'reset') {
    return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400 });
  }
  if (!liveConfigured()) {
    return NextResponse.json({ error: 'Cloudflare Stream není na serveru nastavený.' }, { status: 503 });
  }

  // Zablokovaný účet vysílat nesmí.
  const { data: profile } = await supabaseServer.from('profiles').select('username, is_banned').eq('id', user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profil nenalezen.' }, { status: 404 });
  if (profile.is_banned) return NextResponse.json({ error: 'Účet je zablokovaný.' }, { status: 403 });

  const { input, stream } = await loadSetup(user.id);
  if (isMissingTable(input.error) || isMissingTable(stream.error)) {
    return NextResponse.json({ error: 'Živé vysílání ještě není v databázi zapnuté (migrace).' }, { status: 503 });
  }

  if (action === 'create' && input.data) {
    return NextResponse.json({
      input: { rtmpsUrl: input.data.rtmps_url, streamKey: input.data.stream_key, srtUrl: input.data.srt_url, createdAt: input.data.created_at },
      stream: stream.data ? await publicLive(stream.data as LiveStreamRow) : null,
    });
  }

  // Nový klíč nejvýš jednou za minutu - každý stojí volání Cloudflare.
  if (action === 'reset' && input.data && Date.now() - new Date(input.data.created_at).getTime() < 60 * 1000) {
    return NextResponse.json({ error: 'Nový klíč jde vytvořit nejdřív za minutu.' }, { status: 429 });
  }
  // Vstup vypnutý na přestávku (přenos delší než strop - lib/liveLimits.ts): nový klíč ji neobejde.
  const disabledUntil = (input.data as any)?.disabled_until ? Date.parse((input.data as any).disabled_until) : NaN;
  if (action === 'reset' && Number.isFinite(disabledUntil) && disabledUntil > Date.now()) {
    return NextResponse.json({ error: 'Vysílání má teď krátkou přestávku (přenos běžel moc dlouho). Zkus to za pár minut.', code: 'cooldown' }, { status: 429 });
  }

  let created;
  try {
    created = await createLiveInput(`Kine: ${profile.username ?? user.id}`);
  } catch (e) {
    return NextResponse.json({ error: `Cloudflare vstup nevytvořil: ${(e as Error).message}` }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const inputRow = {
    owner_id: user.id,
    cf_input_id: created.uid,
    rtmps_url: created.rtmpsUrl,
    stream_key: created.streamKey,
    srt_url: created.srtUrl,
    created_at: nowIso,
  };
  // Dvě žádosti naráz (dvojklik, dvě okna) nesmí založit dva vstupy - ten
  // druhý by u Cloudflare zůstal bez majitele a šlo by do něj vysílat mimo Kine.
  // Proto: nový vstup jen když žádný není (insert), výměna jen toho, který byl (update s podmínkou).
  const saveInput = input.data
    ? await supabaseServer.from('live_inputs').update(inputRow).eq('owner_id', user.id).eq('cf_input_id', input.data.cf_input_id).select('owner_id')
    : await supabaseServer.from('live_inputs').insert(inputRow).select('owner_id');
  const won = !saveInput.error && (saveInput.data ?? []).length > 0;
  if (!won) {
    await deleteLiveInput(created.uid);
    const lost = saveInput.error?.code === '23505' || (!saveInput.error && (saveInput.data ?? []).length === 0);
    if (!lost) return NextResponse.json({ error: saveInput.error?.message ?? 'Klíč se nepodařilo uložit.' }, { status: 500 });
    // Mezitím klíč založila jiná žádost - vrátí se ten.
    const again = await loadSetup(user.id);
    return NextResponse.json({
      input: again.input.data
        ? { rtmpsUrl: again.input.data.rtmps_url, streamKey: again.input.data.stream_key, srtUrl: again.input.data.srt_url, createdAt: again.input.data.created_at }
        : null,
      stream: again.stream.data ? await publicLive(again.stream.data as LiveStreamRow) : null,
    });
  }
  if ((input.data as any)?.disabled_at) {
    // Nový vstup u Cloudflare je zapnutý - starý záznam o vypnutí pryč.
    await supabaseServer.from('live_inputs').update({ disabled_at: null, disabled_reason: null, disabled_until: null }).eq('owner_id', user.id).then(
      () => undefined,
      () => undefined
    );
  }
  const saveStream = await supabaseServer
    .from('live_streams')
    .upsert(
      {
        owner_id: user.id,
        cf_input_id: created.uid,
        is_live: false,
        current_video_uid: null,
        updated_at: nowIso,
        ...(stream.data ? {} : { title: '', description: '' }),
      },
      { onConflict: 'owner_id' }
    )
    .select('*')
    .single();

  // Starý klíč přestane platit (vysílání s ním Cloudflare odmítne).
  if (action === 'reset' && input.data?.cf_input_id && input.data.cf_input_id !== created.uid) {
    await deleteLiveInput(input.data.cf_input_id);
  }

  return NextResponse.json({
    input: { rtmpsUrl: created.rtmpsUrl, streamKey: created.streamKey, srtUrl: created.srtUrl, createdAt: nowIso },
    stream: saveStream.data ? await publicLive(saveStream.data as LiveStreamRow) : null,
  });
}
