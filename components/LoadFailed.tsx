'use client';

import { useLanguage } from '@/lib/i18n';

/**
 * Hláška "nenačetlo se to" s tlačítkem na další pokus.
 *
 * Stránky se dosud načítaly stylem "dokud nemám data, ukazuj kostru".
 * Když dotaz spadl - vypadlo wifi, Supabase neodpovědělo, tunel v metru -
 * nikdo tu chybu nezachytil, stav se nezměnil a kostra zůstala na
 * obrazovce napořád. Vypadalo to, jako by se appka zasekla, a jediné,
 * co s tím šlo dělat, bylo obnovit stránku.
 *
 * Odsud se aspoň dá poznat, co se stalo, a zkusit to znovu bez ztráty
 * toho, kde v appce člověk byl.
 */
export default function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="load-failed" role="alert">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 3a9 9 0 1 1-9 9" />
        <path d="M12 8v5" />
        <path d="M12 16.5v.01" />
      </svg>
      <div className="load-failed-text">
        <p className="load-failed-title">{t('loadFailedTitle')}</p>
        <p className="load-failed-note">{t('loadFailedNote')}</p>
      </div>
      <button type="button" className="load-failed-retry" onClick={onRetry}>
        {t('tryAgainButton')}
      </button>
    </div>
  );
}
