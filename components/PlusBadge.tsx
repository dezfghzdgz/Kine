'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { hasKinePlus } from '@/lib/plus';

/**
 * Odznak PLUS u jména - má ho, kdo platí Kine Plus nebo Kine Plus + Klipy
 * (lib/plus.ts). Samotné Klipy Plus (jen appka) odznak nedávají.
 *
 * Plán si načítá sám podle id - stránky ho nemusí přidávat do svých
 * dotazů na profil. Díky tomu se nic nerozbije, když migrace
 * supabase-migration-kine-plus.sql ještě neproběhla: dotaz na chybějící
 * sloupec skončí chybou a odznak se prostě neukáže.
 */
const cache = new Map<string, boolean>();

export default function PlusBadge({ userId, size = 'sm' }: { userId?: string | null; size?: 'sm' | 'md' }) {
  const [plus, setPlus] = useState<boolean>(userId ? cache.get(userId) ?? false : false);

  useEffect(() => {
    if (!userId) return;
    if (cache.has(userId)) {
      setPlus(cache.get(userId)!);
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('plan, plan_until')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        const value = !error && hasKinePlus(data?.plan, data?.plan_until);
        cache.set(userId, value);
        if (!cancelled) setPlus(value);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!plus) return null;

  return (
    <span
      className="plus-badge"
      title="Kine Plus"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        marginLeft: 6,
        padding: size === 'md' ? '2px 8px' : '1px 6px',
        borderRadius: 999,
        fontSize: size === 'md' ? 12 : 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: 'var(--brand)',
        background: 'var(--brand-soft)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--brand-rgb), 0.35)',
        lineHeight: 1.4,
      }}
    >
      PLUS
    </span>
  );
}
