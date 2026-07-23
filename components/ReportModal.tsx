'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

const REASON_KEYS = [
  'reasonSpam', 'reasonInappropriate', 'reasonRuleViolation',
  'reasonIllegal', 'reasonHarassment', 'reasonOther',
] as const;

export default function ReportModal({
  videoId,
  commentId,
  onClose,
}: {
  videoId?: string;
  commentId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [reason, setReason] = useState<typeof REASON_KEYS[number]>(REASON_KEYS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.push('/login');
      return;
    }

    setSubmitting(true);
    await supabase.from('reports').insert({
      reporter_id: authData.user.id,
      video_id: videoId ?? null,
      comment_id: commentId ?? null,
      reason: t(reason),
      details: details.trim() || null,
    });
    setSubmitting(false);
    setDone(true);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div className="panel" style={{ width: '100%', maxWidth: 420, background: 'var(--panel)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <p className="panel-heading" style={{ margin: 0 }}>
            {commentId ? t('reportComment') : t('reportVideo')}
          </p>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-faint)', padding: 4 }}>✕</button>
        </div>

        {done ? (
          <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>
            {t('reportThanks')}
          </p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('reason')}</label>
              <select value={reason} onChange={(e) => setReason(e.target.value as typeof REASON_KEYS[number])}>
                {REASON_KEYS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('reportDetailsLabel')}</label>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder={t('reportDetailsPlaceholder')} />
            </div>
            <button type="submit" disabled={submitting}>{submitting ? t('submittingReport') : t('submitReport')}</button>
          </form>
        )}
      </div>
    </div>
  );
}
