'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows } from '@/lib/loadAll';
import { useUserRole } from '@/lib/useUserRole';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import LoadFailed from '@/components/LoadFailed';
import { SkeletonRows } from '@/components/Skeleton';

type Filter = 'open' | 'done' | 'all';
type Sort = 'count' | 'recent';

/**
 * Fronta hlášení pro moderátory.
 *
 * Dřív to byl seznam jednotlivých hlášení: jedno video nahlášené stokrát
 * znamenalo sto řádků a moderátor musel stokrát kliknout "vyřídit".
 * Přitom je to jedno rozhodnutí, ne sto.
 *
 * Odteď je jedna položka = jeden nahlášený kus obsahu. Vedle něj je
 * číslo, kolikrát byl nahlášený a z jakých důvodů - to je totiž ta
 * informace, podle které se moderátor rozhoduje. Sto hlášení "spam" je
 * něco jiného než jedno hlášení "spam".
 */
export default function ModerationReportsPage() {
  const { t, lang } = useLanguage();
  const { isModerator } = useUserRole();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const [sort, setSort] = useState<Sort>('count');
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setChecked(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isModerator) load();
  }, [isModerator]);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      // Po dávkách: fronta hlášení je přesně to místo, kde se strop tisíce
      // řádků potká se stovkami hlášení jednoho videa.
      const rows = await fetchAllRows((from, to) =>
        supabase
          .from('reports')
          .select(
            'id, reason, details, status, created_at, video_id, comment_id, reporter_id, ' +
              'profiles!reports_reporter_id_fkey(username), ' +
              'videos(id, title, thumbnail_url, owner_id, profiles!videos_owner_id_fkey(username))'
          )
          .order('created_at', { ascending: false })
          .range(from, to)
      );
      setReports(rows);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  /** Hlášení téhož obsahu se sloučí do jedné položky. */
  const groups = useMemo(() => {
    const map = new Map<string, any>();

    for (const r of reports) {
      const key = r.video_id ? `v:${r.video_id}` : r.comment_id ? `c:${r.comment_id}` : `r:${r.id}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          videoId: r.video_id ?? null,
          video: r.videos ?? null,
          ownerId: r.videos?.owner_id ?? null,
          items: [] as any[],
          reasons: new Map<string, number>(),
          reporters: new Set<string>(),
          first: r.created_at,
          last: r.created_at,
        };
        map.set(key, g);
      }

      g.items.push(r);
      const reason = r.reason ?? '—';
      g.reasons.set(reason, (g.reasons.get(reason) ?? 0) + 1);
      if (r.reporter_id) g.reporters.add(r.reporter_id);
      if (r.created_at < g.first) g.first = r.created_at;
      if (r.created_at > g.last) g.last = r.created_at;
    }

    return [...map.values()].map((g) => ({
      ...g,
      openCount: g.items.filter((r: any) => r.status !== 'reviewed').length,
      notes: g.items.filter((r: any) => r.details?.trim()),
    }));
  }, [reports]);

  /** Kolik dalších videí toho samého tvůrce má hlášení. */
  const otherByOwner = useMemo(() => {
    const perOwner = new Map<string, Set<string>>();
    for (const g of groups) {
      if (!g.ownerId || !g.videoId) continue;
      if (!perOwner.has(g.ownerId)) perOwner.set(g.ownerId, new Set());
      perOwner.get(g.ownerId)!.add(g.videoId);
    }
    return perOwner;
  }, [groups]);

  const shown = useMemo(() => {
    const filtered = groups.filter((g) =>
      filter === 'open' ? g.openCount > 0 : filter === 'done' ? g.openCount === 0 : true
    );
    return filtered.sort((a, b) =>
      sort === 'count' ? b.items.length - a.items.length : b.last.localeCompare(a.last)
    );
  }, [groups, filter, sort]);

  const openGroups = groups.filter((g) => g.openCount > 0).length;
  const doneGroups = groups.length - openGroups;

  /** Vyřídí všechna hlášení jedné položky naráz - je to jedno rozhodnutí. */
  async function markGroupReviewed(group: any) {
    const ids = group.items.filter((r: any) => r.status !== 'reviewed').map((r: any) => r.id);
    if (ids.length === 0) return;

    setWorking(group.key);
    // Po stovkách, ať adresa dotazu nepřeroste - u videa se stovkami
    // hlášení by se jinak neprovedl vůbec.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase.from('reports').update({ status: 'reviewed' }).in('id', chunk);
      if (error) {
        setWorking(null);
        setLoadFailed(true);
        return;
      }
    }
    setWorking(null);
    setReports((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, status: 'reviewed' } : r)));
  }

  function toggleDetails(key: string) {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reasonLabel(reason: string) {
    // Důvod se ukládá jako klíč, přeloží se až tady - jinak by měl
    // moderátor frontu v pěti jazycích podle toho, jaký jazyk měl zrovna
    // nahlašující.
    return reason?.startsWith('reason') ? t(reason as any) : reason;
  }

  function den(iso: string) {
    return new Date(iso).toLocaleDateString(DATE_LOCALES[lang]);
  }

  if (!checked) return null;

  if (!isModerator) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('moderatorOnlyPageNote')}</p>;
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <p className="section-title">{t('reportsPageTitle')}</p>

      {loadFailed && <LoadFailed onRetry={load} />}

      {loading ? (
        <SkeletonRows count={5} />
      ) : (
        <>
          <div className="reports-toolbar">
            {([
              ['open', t('reportsFilterOpen'), openGroups],
              ['done', t('reportsFilterDone'), doneGroups],
              ['all', t('reportsFilterAll'), groups.length],
            ] as [Filter, string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'reports-filter reports-filter-active' : 'reports-filter'}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
              >
                {label}
                <span className="reports-filter-count">{count}</span>
              </button>
            ))}

            <span style={{ flex: 1 }} />

            {([
              ['count', t('reportsSortCount')],
              ['recent', t('reportsSortRecent')],
            ] as [Sort, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={sort === key ? 'reports-filter reports-filter-active' : 'reports-filter'}
                onClick={() => setSort(key)}
                aria-pressed={sort === key}
              >
                {label}
              </button>
            ))}
          </div>

          {shown.length === 0 && <p style={{ color: 'var(--text-faint)' }}>{t('noReportsNote')}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map((g) => {
              const jinaVidea = g.ownerId ? (otherByOwner.get(g.ownerId)?.size ?? 1) - 1 : 0;
              const detailsOpen = openDetails.has(g.key);

              return (
                <div key={g.key} className={g.openCount === 0 ? 'report-group report-group-done' : 'report-group'}>
                  <div className="report-group-thumb">
                    {g.video?.thumbnail_url ? (
                      // Náhled schválně obyčejným <img>: je jich na stránce
                      // hodně a všechny jsou malé.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.video.thumbnail_url} alt="" loading="lazy" />
                    ) : (
                      <span aria-hidden="true">💬</span>
                    )}
                  </div>

                  <div className="report-group-body">
                    {g.videoId && g.video ? (
                      <Link href={`/watch/${g.videoId}`} className="report-group-title" style={{ display: 'block' }}>
                        {g.video.title}
                      </Link>
                    ) : (
                      <p className="report-group-title">{t('reportsCommentTarget')}</p>
                    )}

                    <p className="report-group-meta">
                      {g.video?.profiles?.username ?? '—'} ·{' '}
                      {t('reportsFirstLast').replace('{first}', den(g.first)).replace('{last}', den(g.last))}
                    </p>

                    <span
                      className={
                        g.items.length >= 5 ? 'report-group-count' : 'report-group-count report-group-count-low'
                      }
                    >
                      {t('reportsTimesReported').replace('{count}', String(g.items.length))}
                      {g.reporters.size > 1 && (
                        <> · {t('reportsUniqueReporters').replace('{count}', String(g.reporters.size))}</>
                      )}
                    </span>

                    <ul className="report-reasons">
                      {[...g.reasons.entries()]
                        .sort((a, b) => (b[1] as number) - (a[1] as number))
                        .map(([reason, count]) => (
                          <li key={reason as string} className="report-reason">
                            {reasonLabel(reason as string)} <strong>{count as number}×</strong>
                          </li>
                        ))}
                    </ul>

                    {jinaVidea > 0 && (
                      <p className="report-flag">
                        {t('reportsCreatorOther').replace('{count}', String(jinaVidea))}
                      </p>
                    )}

                    {detailsOpen &&
                      g.notes.map((r: any) => (
                        <p key={r.id} className="report-details">
                          {r.details}
                          <br />
                          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>
                            {t('reportedByLabel')} {r.profiles?.username ?? '—'} · {den(r.created_at)}
                          </span>
                        </p>
                      ))}

                    <div className="report-group-actions">
                      {g.openCount > 0 && (
                        <button type="button" onClick={() => markGroupReviewed(g)} disabled={working === g.key}>
                          {g.openCount > 1 ? t('reportsMarkAllDone') : t('reportsMarkOneDone')}
                          {g.openCount > 1 ? ` (${g.openCount})` : ''}
                        </button>
                      )}
                      {g.notes.length > 0 && (
                        <button type="button" onClick={() => toggleDetails(g.key)}>
                          {detailsOpen
                            ? t('reportsHideDetails')
                            : t('reportsShowDetails').replace('{count}', String(g.notes.length))}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
