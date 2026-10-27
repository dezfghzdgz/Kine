/**
 * Zpracování videí u Cloudflare - čistá pravidla pro lib/markVideoReady.ts
 * (testy: tests/videoProcessing.test.mjs).
 */

/**
 * Nahrání u Cloudflare nedokončené (stav "pendingupload") ani den po potvrzení:
 * soubor už nedorazí - video se označí jako nepovedené, ať nevisí napořád
 * a neblokuje úklid zaseklých videí.
 */
export const PENDING_UPLOAD_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export function uploadNeverFinished(cfState: unknown, createdAt: unknown, now = Date.now()): boolean {
  if (cfState !== 'pendingupload') return false;
  const created = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  return Number.isFinite(created) && now - created > PENDING_UPLOAD_GIVE_UP_MS;
}

/**
 * Pořadí úklidu zaseklých videí: nejnovější napřed, pak nejstarší (bez opakování).
 * Dřív jen nejstarší - pár videí, která se u Cloudflare nikdy nedokončí, úklid
 * zablokovalo a nová nahrávání (klipy z mobilu) na Kine nenaskočila.
 */
export function sweepOrder(newest: { id: string }[] | null | undefined, oldest: { id: string }[] | null | undefined): { id: string }[] {
  const seen = new Set<string>();
  const out: { id: string }[] = [];
  for (const row of [...(newest ?? []), ...(oldest ?? [])]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
