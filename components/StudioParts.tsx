'use client';

import { useRef, useState, type ReactNode } from 'react';
import UiIcon, { type UiIconName } from './UiIcon';
import FieldHint from './FieldHint';

/**
 * Stavebnice pro Vytvořit (app/upload) a Upravit video (app/your-videos/[id]/edit):
 * karta s ikonou v hlavičce, plocha pro přetažení souboru, výběr jako karty
 * a ukazatel kroků. Jen vzhled - logika nahrávání zůstává ve stránkách.
 */

export function StudioCard({
  icon,
  title,
  hint,
  aside,
  children,
  id,
}: {
  icon: UiIconName;
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="studio-card" id={id}>
      <header className="studio-card-head">
        <span className="studio-card-icon" aria-hidden="true">
          <UiIcon name={icon} size={17} />
        </span>
        <h2>
          {title}
          {hint && <FieldHint text={hint} />}
        </h2>
        {aside && <span className="studio-card-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/** Plocha „přetáhni sem nebo vyber“ (soubor se dá i přetáhnout myší). */
export function StudioDropzone({
  accept,
  multiple = false,
  icon,
  title,
  hint,
  button,
  compact = false,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  icon: UiIconName;
  title: string;
  hint?: ReactNode;
  button: string;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accepts = (f: File) => {
    if (accept === 'video/*') return f.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name);
    if (accept.startsWith('image/')) return f.type.startsWith('image/');
    return true;
  };
  return (
    <label
      className={`studio-drop${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []).filter(accepts);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="studio-drop-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <span className="studio-drop-icon" aria-hidden="true">
        <UiIcon name={icon} size={compact ? 20 : 28} />
      </span>
      <span className="studio-drop-title">{title}</span>
      {hint && <span className="studio-drop-hint">{hint}</span>}
      <span className="studio-drop-btn">{button}</span>
    </label>
  );
}

/** Výběr jedné možnosti jako karty (ikona, název, popis) - radio pod kapotou. */
export function StudioChoices<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; icon: UiIconName; title: string; desc: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="studio-choices" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className={`studio-choice${value === o.value ? ' active' : ''}`}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="studio-choice-icon" aria-hidden="true">
            <UiIcon name={o.icon} size={18} />
          </span>
          <span className="studio-choice-text">
            <span className="studio-choice-title">{o.title}</span>
            <span className="studio-choice-desc">{o.desc}</span>
          </span>
          <span className="studio-choice-check" aria-hidden="true">
            <UiIcon name="check" size={14} />
          </span>
        </label>
      ))}
    </div>
  );
}

/** Kroky nahoře (1 Detaily -> 2 Zveřejnění). */
export function StudioSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="studio-steps">
      {steps.map((label, i) => (
        <li key={label} className={i === current ? 'active' : i < current ? 'done' : undefined} aria-current={i === current ? 'step' : undefined}>
          <span className="studio-step-num">{i < current ? <UiIcon name="check" size={13} /> : i + 1}</span>
          <span className="studio-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** Kontrolní seznam v boku (hotovo / doporučeno). */
export function StudioChecklist({ title, items }: { title: string; items: { label: string; done: boolean; required?: boolean }[] }) {
  return (
    <div className="studio-checklist">
      <p className="studio-side-title">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item.label} className={item.done ? 'done' : item.required ? 'todo required' : 'todo'}>
            <span className="studio-check-dot" aria-hidden="true">
              {item.done ? <UiIcon name="check" size={12} /> : null}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Počítadlo znaků u pole (zčervená u limitu). */
export function CharCount({ value, max }: { value: string; max: number }) {
  const n = value.length;
  return <span className={`studio-count${n >= max ? ' full' : n > max * 0.9 ? ' near' : ''}`}>{`${n}/${max}`}</span>;
}

/** 1,2 GB / 350 MB */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** Popisek rozlišení podle kratší strany (svislé video 1080×1920 = 1080p). */
export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  const short = Math.min(width, height);
  if (short >= 2160) return '4K';
  if (short >= 1440) return '1440p';
  if (short >= 1080) return '1080p';
  if (short >= 720) return '720p';
  return `${short}p`;
}
