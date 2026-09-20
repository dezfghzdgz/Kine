/**
 * Oznámení o porušení autorských práv - ověření formuláře bez prohlížeče
 * a bez databáze (tests/copyrightNotice.test.mjs). Formulář je /copyright,
 * zápis dělá app/api/copyright-notice.
 */

export type NoticeInput = {
  name: string;
  email: string;
  organization?: string;
  videoUrl: string;
  description: string;
  goodFaith: boolean;
};

export type NoticeProblem = 'name' | 'email' | 'video' | 'description' | 'goodFaith';

export const NOTICE_DESCRIPTION_MIN = 20;
export const NOTICE_DESCRIPTION_MAX = 4000;
/** Kolik oznámení smí přijít z jedné adresy za hodinu - formulář je bez přihlášení. */
export const NOTICES_PER_HOUR_PER_IP = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Vrátí seznam polí, která nejsou v pořádku (prázdný = pošli). */
export function validateNotice(input: NoticeInput, videoIdFromUrl: (url: string) => string | null): NoticeProblem[] {
  const problems: NoticeProblem[] = [];
  if (!input.name || input.name.trim().length < 2 || input.name.length > 200) problems.push('name');
  if (!input.email || !EMAIL.test(input.email.trim()) || input.email.length > 320) problems.push('email');
  if (!input.videoUrl || !videoIdFromUrl(input.videoUrl.trim())) problems.push('video');
  const description = (input.description ?? '').trim();
  if (description.length < NOTICE_DESCRIPTION_MIN || description.length > NOTICE_DESCRIPTION_MAX) problems.push('description');
  if (!input.goodFaith) problems.push('goodFaith');
  return problems;
}

/** Vyčistí text: ořízne a zkrátí, ať do databáze nejde román ani nekonečný řádek. */
export function tidy(text: string | null | undefined, max: number): string | null {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}
