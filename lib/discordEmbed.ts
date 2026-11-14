/**
 * Náhled odkazu na video v Discordu jako u Medalu: název, tvůrce · hra,
 * video, které jde přehrát rovnou v Discordu, a tlačítka "Watch on Kine",
 * "Follow on Kine", "Download for PC".
 *
 * Jak to Discord dělá (docs.discord.com/developers/link-previews):
 *  - Přehrávač v náhledu jen pro OBYČEJNÝ soubor videa (.mp4/.webm/.mov)
 *    v og:video. Náš /embed (stránka s přehrávačem) Discord nepřehraje -
 *    proto dřív náhled ukazoval jen obrázek. Cloudflare Stream umí k videu
 *    vyrobit MP4 (úložiště nic nestojí, platí se jen přehrání - jako u
 *    přehrávače), jen se o něj musí požádat (lib/streamMp4.ts).
 *  - Tlačítka a vlastní rozvržení = "component embed": JSON (nejvýš
 *    3 000 bajtů) z adresy v <link rel="discord:component-embed">. Jen
 *    tlačítka-odkazy (style 5), jeden Container (type 17) navrchu.
 *  - Když JSON nejde, Discord ukáže obyčejný náhled z Open Graph.
 *
 * Čistá logika - test: tests/discordEmbed.test.mjs.
 */

/** Nejdelší video, které se v Discordu přehraje rovnou (MP4 nesmí být obří - Discord stahuje nejvýš 50 MB na odkaz). */
export const DISCORD_VIDEO_MAX_SECONDS = 180;
/** Limit Discordu na JSON náhledu (bajty, UTF-8). */
export const DISCORD_EMBED_MAX_BYTES = 3000;

/** Hodí se video na přehrání přímo v Discordu (klipy, Sparks, krátká videa)? */
export function discordVideoEligible(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= DISCORD_VIDEO_MAX_SECONDS;
}

/** Adresa MP4 u Cloudflare Stream (vznikne až po žádosti o stažení - viz lib/streamMp4.ts). */
export function streamMp4Url(customerCode: string, cloudflareVideoId: string): string {
  return `https://customer-${customerCode}.cloudflarestream.com/${cloudflareVideoId}/downloads/default.mp4`;
}

/**
 * Text pro Discord bez markdownu: název videa od uživatele nesmí udělat
 * odkaz ("[klikni](…)"), tučné písmo ani nadpis - všechno se zpětným
 * lomítkem ukáže, jak je napsané.
 */
export function escapeDiscordMarkdown(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/([\\*_~`|>#\[\]()<:@!-])/g, '\\$1')
    .trim();
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

export type DiscordEmbedInput = {
  title: string;
  creator: string;
  /** Název hry (z hashtagů videa), nebo null. */
  game: string | null;
  watchUrl: string;
  /** Kanál tvůrce (tlačítko Follow); null = bez tlačítka. */
  channelUrl: string | null;
  /** Stažení appky do PC. */
  downloadUrl: string;
  /** MP4 videa (přehraje se v Discordu), nebo obrázek náhledu; null = bez obrázku. */
  mediaUrl: string | null;
  /** Barva proužku vlevo (#rrggbb). */
  accent?: string | null;
};

export type DiscordComponent = Record<string, unknown>;

function accentInt(color: string | null | undefined): number | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec((color ?? '').trim());
  return m ? parseInt(m[1], 16) : undefined;
}

function build(input: DiscordEmbedInput, titleMax: number, creatorMax: number): { component: DiscordComponent } {
  const title = escapeDiscordMarkdown(truncate(input.title || 'Video', titleMax));
  const byline = [truncate(input.creator || 'Kine', creatorMax), input.game ? truncate(input.game, 60) : null]
    .filter((x): x is string => !!x)
    .map(escapeDiscordMarkdown)
    .join(' · ');
  const buttons: DiscordComponent[] = [{ type: 2, style: 5, url: input.watchUrl, label: 'Watch on Kine' }];
  if (input.channelUrl) buttons.push({ type: 2, style: 5, url: input.channelUrl, label: 'Follow on Kine' });
  buttons.push({ type: 2, style: 5, url: input.downloadUrl, label: 'Download for PC' });
  const components: DiscordComponent[] = [{ type: 10, content: `### ${title}\n${byline}` }];
  if (input.mediaUrl) components.push({ type: 12, items: [{ media: { url: input.mediaUrl } }] });
  components.push({ type: 1, components: buttons });
  const container: DiscordComponent = { type: 17, components };
  const accent = accentInt(input.accent);
  if (accent !== undefined) container.accent_color = accent;
  return { component: container };
}

/** Velikost JSON tak, jak ho Discord počítá (UTF-8 bajty, escapované znaky v plné délce). */
export function payloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * JSON náhledu pro Discord. Když by přesáhl 3 000 bajtů (dlouhý název,
 * hodně escapovaných znaků), zkracuje se název a jméno tvůrce; null =
 * nevejde se ani tak (pak zbude obyčejný náhled z Open Graph).
 */
export function discordEmbedPayload(input: DiscordEmbedInput): { component: DiscordComponent } | null {
  for (const [titleMax, creatorMax] of [
    [100, 60],
    [60, 40],
    [30, 24],
  ] as const) {
    const payload = build(input, titleMax, creatorMax);
    if (payloadBytes(payload) <= DISCORD_EMBED_MAX_BYTES) return payload;
  }
  return null;
}
