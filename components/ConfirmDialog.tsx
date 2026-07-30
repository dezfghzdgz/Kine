'use client';

import { useLanguage } from '@/lib/i18n';

export default function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel,
  danger = true,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'modal-backdrop-fade-in 0.15s ease' }}
      onClick={onCancel}
    >
      <div className="panel" style={{ width: '100%', maxWidth: 360, background: 'var(--panel)', animation: 'modal-pop-in 0.18s ease' }} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 0, marginBottom: 20 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, background: 'var(--panel-raised)', color: 'var(--text)' }}>
            {t('cancel')}
          </button>
          <button onClick={onConfirm} style={{ flex: 1, background: danger ? '#b03a3a' : 'var(--text)', color: danger ? '#fff' : 'var(--bg)' }}>
            {confirmLabel ?? t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
