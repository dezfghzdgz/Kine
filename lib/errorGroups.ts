/**
 * Seskupení nahlášených chyb pro /admin/errors.
 *
 * Sto stejných chyb je jedno rozhodnutí, ne sto řádků - stejně jako u
 * hlášení videí. Jedna skupina = jeden otisk (viz lib/errorReporter.ts):
 * kolikrát, kdy naposled, na jakých adresách a zařízeních, ukázka
 * zásobníku. Čisté, s testem: tests/errorGroups.test.mjs.
 */

export interface ErrorRow {
  id: string;
  created_at: string;
  kind: string;
  message: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  device: string | null;
  fingerprint: string;
}

export interface ErrorGroup {
  fingerprint: string;
  message: string;
  kind: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Adresy, kde se to stalo, s počty - nejčastější napřed. */
  urls: { url: string; count: number }[];
  devices: Record<string, number>;
  /** Ukázka zásobníku z nejnovějšího výskytu. */
  sampleStack: string | null;
  sampleUserAgent: string | null;
}

export function groupErrors(rows: ErrorRow[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup & { urlCounts: Map<string, number>; stackAt: string; uaAt: string }>();

  for (const row of rows) {
    const key = row.fingerprint || row.message;
    let g = groups.get(key);
    if (!g) {
      g = {
        fingerprint: key,
        message: row.message,
        kind: row.kind,
        count: 0,
        firstSeen: row.created_at,
        lastSeen: row.created_at,
        urls: [],
        devices: {},
        sampleStack: null,
        sampleUserAgent: null,
        urlCounts: new Map(),
        stackAt: '',
        uaAt: '',
      };
      groups.set(key, g);
    }

    g.count++;
    if (row.created_at < g.firstSeen) g.firstSeen = row.created_at;
    if (row.created_at > g.lastSeen) g.lastSeen = row.created_at;
    // Ukázka z nejnovějšího výskytu, který ji má - ne z nejnovějšího vůbec,
    // ten může být bez zásobníku.
    if (row.stack && row.created_at > g.stackAt) {
      g.stackAt = row.created_at;
      g.sampleStack = row.stack;
    }
    if (row.user_agent && row.created_at > g.uaAt) {
      g.uaAt = row.created_at;
      g.sampleUserAgent = row.user_agent;
    }
    if (row.url) g.urlCounts.set(row.url, (g.urlCounts.get(row.url) ?? 0) + 1);
    const d = row.device ?? 'neznámé';
    g.devices[d] = (g.devices[d] ?? 0) + 1;
  }

  return [...groups.values()]
    .map(({ urlCounts, stackAt, uaAt, ...g }) => ({
      ...g,
      urls: [...urlCounts.entries()]
        .map(([url, count]) => ({ url, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    }))
    // Nejčastější napřed; při shodě to, co se stalo naposled.
    .sort((a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1));
}
