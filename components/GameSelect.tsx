'use client';

import { useLanguage } from '@/lib/i18n';
import { GAME_GENRES, GAMES, GENRE_KEYS } from '@/lib/games';

/**
 * Výběr hry (nahrávání, úprava videa, studio vysílání). Hry podle žánru,
 * uvnitř podle abecedy; prázdná hodnota = bez hry.
 */
export default function GameSelect({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id?: string;
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{t('gameNone')}</option>
      {GAME_GENRES.map((genre) => (
        <optgroup key={genre} label={t(GENRE_KEYS[genre] as any)}>
          {GAMES.filter((g) => g.genre === genre)
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
