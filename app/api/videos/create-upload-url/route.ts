import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { RESUMABLE_FROM_BYTES, base64Ascii } from '@/lib/tusUpload';
import { checkUpload, declaredDuration, uploadsPaused } from '@/lib/uploadLimits';
import { createTicket, limitsForProfile, uploadProfile, uploadUsage } from '@/lib/uploadTickets';
import { cloudflareStorageFull, cloudflareStreamCreds, deleteStreamVideo, streamApiUrl } from '@/lib/cloudflareVideos';
import { outdatedAppResponse } from '@/lib/desktopGate';
import { kineAppFrom } from '@/lib/desktopClient';

export const dynamic = 'force-dynamic';

/**
 * Adresa pro nahrání videa přímo do Cloudflare Stream (prohlížeč i appka
 * do PC posílají soubor rovnou tam, ne přes náš server).
 *
 * Tělo: { fileSize, durationSeconds?, preferResumable? }
 *
 * Než adresu vydá, ohlídá limity (lib/uploadLimits.ts): délku videa,
 * počet a minuty za 24 hodin, rozpracovaná nahrávání a úložiště účtu.
 * U Cloudflare si zarezervuje jen délku videa (dřív 6 hodin za každé
 * nahrávání - pár požadavků zablokovalo úložiště všem) a nahrávání podepíše
 * id uživatele (creator). K adrese patří lístek (lib/uploadTickets.ts) -
 * bez něj /api/videos/confirm video neuloží.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const user = userData.user;

  const outdated = await outdatedAppResponse(req);
  if (outdated) return outdated;

  const paused = uploadsPaused(process.env);
  if (paused) return NextResponse.json({ error: paused, code: 'paused' }, { status: 503 });

  const cf = cloudflareStreamCreds();
  if (!cf) return NextResponse.json({ error: 'Cloudflare Stream není nakonfigurovaný na serveru.' }, { status: 500 });

  let fileSize = 0;
  let preferResumable = false;
  let declared: number | null = null;
  try {
    const body = await req.json();
    fileSize = Math.max(0, Number(body?.fileSize) || 0);
    // Appka Kine do PC chce po částech vždycky - kvůli průběhu a pokračování po pauze.
    preferResumable = body?.preferResumable === true;
    declared = declaredDuration(body?.durationSeconds);
  } catch {
    // Starší verze stránky tělo neposílala - jede se bez velikosti a délky.
  }

  const profile = await uploadProfile(user.id);
  if (!profile) return NextResponse.json({ error: 'Profil nenalezen - dokonči nejdřív registraci.' }, { status: 403 });
  if (profile.is_banned) return NextResponse.json({ error: 'Účet je zablokovaný.', code: 'banned' }, { status: 403 });

  const limits = limitsForProfile(profile, user.created_at ?? null);
  const { usage } = await uploadUsage(user.id);
  const check = checkUpload(limits, usage, declared);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.message, code: check.code, limits: { maxVideoSeconds: limits.maxVideoSeconds, perDay: limits.perDay } },
      { status: check.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const reserve = check.reserveSeconds;
  const resumable = fileSize > RESUMABLE_FROM_BYTES || (preferResumable && fileSize > 0);
  const created = resumable
    ? await createResumableUpload(cf.accountId, cf.token, fileSize, reserve, user.id)
    : await createBasicUpload(cf.accountId, cf.token, reserve, user.id);
  if (!created.ok) {
    // Do logů Vercelu - podle toho jde poznat, co Cloudflare vadilo.
    console.error('create-upload-url: Cloudflare odmítl nahrávání', created.error, JSON.stringify(created.details ?? null).slice(0, 800));
    // Plné úložiště u Cloudflare (minuty předplatného Stream): ať je jasné, že nejde o chybu appky.
    if (cloudflareStorageFull(created.details)) {
      return NextResponse.json(
        { error: 'Úložiště videí Kine je teď plné - nahrávání chvíli nepůjde. Dej prosím vědět správci Kine.', code: 'cf-storage' },
        { status: 507, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json({ error: created.error, details: created.details }, { status: 502 });
  }

  const ticket = await createTicket({
    userId: user.id,
    cfUid: created.videoId,
    reservedSeconds: reserve,
    declaredSeconds: declared,
    fileBytes: fileSize,
    source: kineAppFrom(req.headers) ? 'desktop' : 'web',
  });
  if (!ticket.ok && !ticket.missingTable) {
    // Bez lístku by video nešlo uložit - nahrávání u Cloudflare se hned zruší.
    await deleteStreamVideo(created.videoId);
    return NextResponse.json({ error: `Nahrávání se nepodařilo připravit: ${ticket.message}` }, { status: 500 });
  }

  return NextResponse.json(
    { mode: created.mode, uploadURL: created.uploadURL, videoId: created.videoId, maxDurationSeconds: reserve },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

type Created = { ok: true; mode: 'basic' | 'tus'; uploadURL: string; videoId: string } | { ok: false; error: string; details?: unknown };

/** Malý soubor (do 200 MB): jedna adresa, jeden požadavek. */
async function createBasicUpload(accountId: string, apiToken: string, reserve: number, userId: string): Promise<Created> {
  try {
    const response = await fetch(streamApiUrl(accountId, '/direct_upload'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxDurationSeconds: reserve,
        requireSignedURLs: false,
        creator: userId,
        meta: { kineUser: userId },
      }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!data?.success || !data?.result?.uploadURL || !data?.result?.uid) {
      return { ok: false, error: 'Cloudflare odmítl vytvořit upload URL.', details: data?.errors };
    }
    return { ok: true, mode: 'basic', uploadURL: data.result.uploadURL, videoId: data.result.uid };
  } catch (e) {
    return { ok: false, error: 'Cloudflare se nepodařilo zavolat.', details: (e as Error).message };
  }
}

/**
 * Nahrávání po částech (protokol tus) - větší soubory a appka do PC.
 *
 * Cloudflare přijme jedním obyčejným požadavkem nejvýš 200 MB. Větší
 * soubor odmítne uprostřed nahrávání - a protože odmítnutá odpověď
 * nenese hlavičky pro cizí doménu, prohlížeč z ní nic nepřečte a ohlásí
 * jen "chyba sítě". "direct_user=true" = vrácená adresa je jednorázová a
 * smí do ní posílat i prohlížeč bez našeho klíče.
 */
async function createResumableUpload(accountId: string, apiToken: string, fileSize: number, reserve: number, userId: string): Promise<Created> {
  // Hodnoty v Upload-Metadata se podle protokolu posílají v base64.
  const metadata = `maxDurationSeconds ${base64Ascii(String(reserve))}`;
  try {
    const response = await fetch(streamApiUrl(accountId, '?direct_user=true'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSize),
        'Upload-Metadata': metadata,
        'Upload-Creator': userId,
      },
      cache: 'no-store',
    });
    const uploadURL = response.headers.get('Location');
    const videoId = response.headers.get('stream-media-id');
    if (!response.ok || !uploadURL || !videoId) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: 'Cloudflare nepřijal nahrávání po částech.', details: detail.slice(0, 500) };
    }
    return { ok: true, mode: 'tus', uploadURL, videoId };
  } catch (e) {
    return { ok: false, error: 'Cloudflare se nepodařilo zavolat.', details: (e as Error).message };
  }
}
