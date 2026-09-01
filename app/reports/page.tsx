'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useUserRole } from '@/lib/useUserRole';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';

export default function ModerationReportsPage() {
  const { t, lang } = useLanguage();
  const { isModerator } = useUserRole();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setChecked(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isModerator) load();
  }, [isModerator]);

  async function load() {
    const { data } = await supabase
      .from('reports')
      .select('id, reason, details, status, created_at, video_id, comment_id, reporter_id, profiles!reports_reporter_id_fkey(username), videos(id, title, thumbnail_url)')
      .order('created_at', { ascending: false });
    setReports(data ?? []);
    setLoading(false);
  }

  async function markReviewed(id: string) {
    await supabase.from('reports').update({ status: 'reviewed' }).eq('id', id);
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'reviewed' } : r)));
  }

  if (!checked) return null;

  if (!isModerator) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('moderatorOnlyPageNote')}</p>;
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  return (
    <div style={{ maxWidth: 760 }}>
      <p className="section-title">{t('reportsPageTitle')}</p>

      {reports.length === 0 && <p style={{ color: 'var(--text-faint)' }}>{t('noReportsNote')}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {reports.map((r) => (
          <div key={r.id} className="panel" style={{ opacity: r.status === 'reviewed' ? 0.5 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                {/* Důvod se ukládá jako klíč, přeloží se až tady - jinak
                    by měl moderátor frontu v pěti jazycích podle toho,
                    jaký jazyk měl zrovna nahlašující. */}
                <p style={{ fontWeight: 600, margin: 0 }}>
                  {r.reason?.startsWith('reason') ? t(r.reason as any) : r.reason}
                </p>
                {r.details && <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '4px 0' }}>{r.details}</p>}
                <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
                  {t('reportedByLabel')} {r.profiles?.username ?? '—'} · {new Date(r.created_at).toLocaleDateString(DATE_LOCALES[lang])}
                </p>
                {r.video_id && r.videos && (
                  <Link href={`/watch/${r.video_id}`} style={{ fontSize: 13 }}>
                    🎬 {r.videos.title}
                  </Link>
                )}
                {r.comment_id && !r.video_id && (
                  <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>{t('reportedCommentNote')}</p>
                )}
              </div>
              {r.status !== 'reviewed' && (
                <button
                  onClick={() => markReviewed(r.id)}
                  style={{ background: 'var(--panel-raised)', color: 'var(--text)', fontSize: 12, alignSelf: 'flex-start' }}
                >
                  {t('markReviewedButton')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
