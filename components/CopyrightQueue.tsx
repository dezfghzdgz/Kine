'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';

type Notice = {
  id: string;
  created_at: string;
  video_id: string | null;
  video_url: string;
  claimant_name: string;
  claimant_email: string;
  claimant_org: string | null;
  work_description: string;
  status: 'open' | 'removed' | 'rejected';
  moderator_note: string | null;
};

/**
 * Fronta oznámení o autorských právech pro moderátory (v /reports).
 *
 * Každé oznámení vyřídí člověk: buď video odstraní (tlačítko vede na
 * stránku videa, kde je smazání pro moderátory) a označí "Odstraněno",
 * nebo oznámení zamítne s poznámkou. Tabulku čtou a upravují jen
 * moderátoři (RLS, supabase-migration-autorska-prava.sql). Bez migrace
 * dotaz spadne a sekce se prostě neukáže.
 */
export default function CopyrightQueue() {
  const { t, lang } = useLanguage();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from('copyright_notices')
      .select('id, created_at, video_id, video_url, claimant_name, claimant_email, claimant_org, work_description, status, moderator_note')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data) {
      setNotices(null);
      return;
    }
    setNotices(data as Notice[]);
  }

  async function resolve(notice: Notice, status: 'removed' | 'rejected') {
    setWorking(notice.id);
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('copyright_notices')
      .update({
        status,
        resolved_at: new Date().toISOString(),
        resolved_by: authData.user?.id ?? null,
        moderator_note: notes[notice.id]?.trim() || null,
      })
      .eq('id', notice.id);
    setWorking(null);
    if (!error) {
      setNotices((prev) => (prev ?? []).map((n) => (n.id === notice.id ? { ...n, status, moderator_note: notes[notice.id] ?? null } : n)));
    }
  }

  if (!notices) return null;

  const open = notices.filter((n) => n.status === 'open');
  const done = notices.filter((n) => n.status !== 'open');
  if (open.length === 0 && done.length === 0) return null;

  const shown = showDone ? notices : open;

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p className="panel-heading" style={{ margin: 0 }}>
          {t('copyrightQueueTitle')}
          {open.length > 0 && <span className="reports-filter-count" style={{ marginLeft: 8 }}>{open.length}</span>}
        </p>
        {done.length > 0 && (
          <button type="button" className="reports-filter" onClick={() => setShowDone((v) => !v)}>
            {showDone ? t('copyrightQueueHideDone') : t('copyrightQueueShowDone').replace('{count}', String(done.length))}
          </button>
        )}
      </div>

      {shown.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: '10px 0 0' }}>{t('copyrightQueueEmpty')}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {shown.map((n) => (
          <div key={n.id} className={n.status === 'open' ? 'report-group' : 'report-group report-group-done'} style={{ display: 'block' }}>
            <p className="report-group-meta" style={{ margin: 0 }}>
              {new Date(n.created_at).toLocaleString(DATE_LOCALES[lang])} · {n.claimant_name}
              {n.claimant_org ? ` (${n.claimant_org})` : ''} ·{' '}
              <a href={`mailto:${n.claimant_email}`} style={{ color: 'var(--text-dim)' }}>{n.claimant_email}</a>
              {n.status !== 'open' && (
                <> · <strong>{n.status === 'removed' ? t('copyrightStatusRemoved') : t('copyrightStatusRejected')}</strong></>
              )}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              {n.video_id ? (
                <Link href={`/watch/${n.video_id}`} className="report-group-title">{t('copyrightQueueOpenVideo')}</Link>
              ) : (
                <span style={{ color: 'var(--text-faint)' }}>{t('copyrightQueueVideoMissing')}</span>
              )}
              <span style={{ color: 'var(--text-faint)' }}> · {n.video_url}</span>
            </p>
            <p className="report-details" style={{ marginTop: 8 }}>{n.work_description}</p>
            {n.moderator_note && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '6px 0 0' }}>{t('copyrightQueueNote')}: {n.moderator_note}</p>
            )}

            {n.status === 'open' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                <input
                  value={notes[n.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [n.id]: e.target.value }))}
                  placeholder={t('copyrightQueueNotePlaceholder')}
                  style={{ flex: 1, minWidth: 200, fontSize: 13 }}
                />
                <button type="button" className="reaction-btn" disabled={working === n.id} onClick={() => resolve(n, 'removed')}>
                  {t('copyrightQueueMarkRemoved')}
                </button>
                <button type="button" className="reaction-btn" disabled={working === n.id} onClick={() => resolve(n, 'rejected')}>
                  {t('copyrightQueueReject')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
