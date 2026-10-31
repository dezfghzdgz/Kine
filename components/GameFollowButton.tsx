'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { countLabel } from '@/lib/plural';
import UiIcon from './UiIcon';

/** Tabulka sledovaných her zatím není (migrace supabase-migration-push-hry-naklady.sql neproběhla). */
function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
}

/**
 * Sledovat hru (/game/[slug]): videa z ní se pak na hlavní stránce
 * nabízejí víc a hra je nahoře na stránce /games. Počet sledujících je
 * veřejný (funkce game_follower_count), kdo co sleduje ne.
 */
export default function GameFollowButton({ slug, onChange }: { slug: string; onChange?: (following: boolean) => void }) {
  const { t, lang } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: s }, countRes] = await Promise.all([supabase.auth.getSession(), supabase.rpc('game_follower_count', { p_game: slug })]);
      if (cancelled) return;
      const uid = s.session?.user?.id ?? null;
      setUserId(uid);
      if (countRes.error) {
        if (missingTable(countRes.error) || /function/i.test(countRes.error.message ?? '')) setAvailable(false);
      } else {
        setCount(typeof countRes.data === 'number' ? countRes.data : Number(countRes.data) || 0);
      }
      if (uid) {
        const { data, error } = await supabase.from('game_follows').select('game').eq('user_id', uid).eq('game', slug).maybeSingle();
        if (cancelled) return;
        if (missingTable(error)) setAvailable(false);
        setFollowing(!!data);
      }
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function toggle() {
    if (!userId || busy) return;
    setBusy(true);
    const next = !following;
    // Hned na obrazovce, při chybě zpátky.
    setFollowing(next);
    setCount((c) => (c === null ? c : Math.max(0, c + (next ? 1 : -1))));
    const { error } = next
      ? await supabase.from('game_follows').insert({ user_id: userId, game: slug })
      : await supabase.from('game_follows').delete().eq('user_id', userId).eq('game', slug);
    // Už sleduje (dvojklik v jiné kartě) = v pořádku.
    if (error && !(next && error.code === '23505')) {
      setFollowing(!next);
      setCount((c) => (c === null ? c : Math.max(0, c + (next ? -1 : 1))));
    } else {
      onChange?.(next);
    }
    setBusy(false);
  }

  if (!available) return null;

  const countText = count !== null ? countLabel(count, lang, t, 'gameFollowers') : null;

  return (
    <div className="game-follow">
      {checked && !userId ? (
        <Link href="/login" className="game-follow-btn">
          <UiIcon name="plus" size={15} />
          {t('gameFollow')}
        </Link>
      ) : (
        <button
          type="button"
          className={`game-follow-btn${following ? ' following' : ''}`}
          onClick={toggle}
          disabled={!checked || busy}
          aria-pressed={following}
          title={following ? t('gameUnfollow') : undefined}
        >
          <UiIcon name={following ? 'check' : 'plus'} size={15} />
          {following ? t('gameFollowing') : t('gameFollow')}
        </button>
      )}
      {countText && <span className="game-follow-count">{countText}</span>}
    </div>
  );
}
