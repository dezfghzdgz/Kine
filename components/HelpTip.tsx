'use client';

import { useState, type ReactNode } from 'react';
import { useLanguage } from '@/lib/i18n';
import UiIcon, { type UiIconName } from './UiIcon';

/**
 * Méně textu v nastavení: u položky je jen krátký popisek a otazníček -
 * vysvětlení se ukáže až po kliknutí (pod položkou, nic nepřekrývá).
 * Stejně jako v Kine do PC / Kine Clipper.
 */
function HelpButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className={`help-btn${open ? ' open' : ''}`}
      aria-expanded={open}
      aria-label={t('helpMore')}
      title={t('helpMore')}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <UiIcon name="help" size={16} />
    </button>
  );
}

/** Řádek (volba, pole) s otazníčkem vpravo a rozbalitelným vysvětlením pod ním. */
export function WithHelp({ help, children, className }: { help?: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!help) return <>{children}</>;
  return (
    <div className={`with-help${className ? ` ${className}` : ''}`}>
      <div className="with-help-row">
        <div className="with-help-main">{children}</div>
        <HelpButton open={open} onToggle={() => setOpen((v) => !v)} />
      </div>
      {open && <div className="help-text">{help}</div>}
    </div>
  );
}

/** Nadpis panelu s ikonou, otazníčkem (volitelně) a věcmi vpravo. */
export function PanelHeading({ icon, title, help, right }: { icon: UiIconName; title: ReactNode; help?: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="panel-title-row">
        <h2 className="panel-title-text">
          <UiIcon name={icon} size={18} />
          <span>{title}</span>
        </h2>
        {help ? <HelpButton open={open} onToggle={() => setOpen((v) => !v)} /> : null}
        {right ? <div className="panel-title-right">{right}</div> : null}
      </div>
      {help && open ? <div className="help-text">{help}</div> : null}
    </>
  );
}
