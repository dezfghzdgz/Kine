'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

/**
 * Srovnání videí mezi sebou.
 *
 * Jedna tabulka, ve které jde kliknutím na hlavičku seřadit podle čehokoliv -
 * zhlédnutí, hodnocení, komentářů, dokoukanosti i doby sledování. Tím se dá
 * rychle najít, co kanálu funguje a co ne.
 */

export type VideoStatsRow = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  created_at: string;
  views: number;
  avgRating: number | null;
  ratingCount: number;
  comments: number;
  completionPercent: number | null;
  watchSeconds: number;
};

type SortKey = 'created_at' | 'views' | 'avgRating' | 'comments' | 'completionPercent' | 'watchSeconds';

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'views', label: 'Zhlédnutí', title: 'Kolikrát se video přehrálo' },
  { key: 'avgRating', label: 'Hodnocení', title: 'Průměrné hodnocení a počet hodnocení' },
  { key: 'comments', label: 'Komentáře', title: 'Počet komentářů pod videem' },
  { key: 'completionPercent', label: 'Dokoukanost', title: 'Kolik procent videa lidi průměrně vidí' },
  { key: 'watchSeconds', label: 'Odsledováno', title: 'Kolik času lidi u videa dohromady strávili' },
  { key: 'created_at', label: 'Nahráno', title: 'Datum nahrání' },
];

export function formatWatchTime(seconds: number): string {
  if (seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.round(seconds)} s`;
}

export default function StatsVideoTable({ rows }: { rows: VideoStatsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [ascending, setAscending] = useState(false);

  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Zatím tu nejsou žádná videa k porovnání.</p>;
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((v) => !v);
    } else {
      setSortKey(key);
      setAscending(false);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    // Videa bez hodnoty (např. bez jediného hodnocení) padají vždycky
    // dolů, ať nezabírají první místa jen proto, že o nich nic nevíme.
    const rawA = a[sortKey];
    const rawB = b[sortKey];
    const numA = sortKey === 'created_at' ? new Date(a.created_at).getTime() : (rawA as number | null);
    const numB = sortKey === 'created_at' ? new Date(b.created_at).getTime() : (rawB as number | null);

    if (numA === null && numB === null) return 0;
    if (numA === null) return 1;
    if (numB === null) return -1;
    return ascending ? numA - numB : numB - numA;
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="stats-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Video</th>
            {COLUMNS.map((col) => (
              <th key={col.key} title={col.title}>
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className={`stats-table-sort ${sortKey === col.key ? 'active' : ''}`}
                >
                  {col.label}
                  <span className="stats-table-arrow">
                    {sortKey === col.key ? (ascending ? '▲' : '▼') : '⇅'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/watch/${row.id}`} className="stats-table-video">
                  <span className="stats-table-thumb">
                    {row.thumbnail_url && (
                      <Image src={row.thumbnail_url} alt={row.title} width={72} height={40} style={{ objectFit: 'cover' }} />
                    )}
                  </span>
                  <span className="stats-table-title">{row.title}</span>
                </Link>
              </td>
              <td>{row.views}</td>
              <td>
                {row.avgRating === null ? '—' : (
                  <>
                    {row.avgRating.toFixed(1)}
                    <span style={{ color: 'var(--text-faint)' }}> ({row.ratingCount})</span>
                  </>
                )}
              </td>
              <td>{row.comments}</td>
              <td>{row.completionPercent === null ? '—' : `${Math.round(row.completionPercent)} %`}</td>
              <td>{formatWatchTime(row.watchSeconds)}</td>
              <td style={{ color: 'var(--text-faint)' }}>
                {new Date(row.created_at).toLocaleDateString('cs-CZ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
