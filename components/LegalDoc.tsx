'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import type { LegalDoc as Doc } from '@/lib/legal';

/** Odkazy v textu (/rules, /copyright...) jako opravdové odkazy, e-mail jako mailto. */
function rich(text: string) {
  const parts = text.split(/(\/(?:rules|terms|privacy|copyright)\b|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g);
  return parts.map((part, i) => {
    if (/^\/(rules|terms|privacy|copyright)$/.test(part)) {
      return (
        <Link key={i} href={part}>
          {part}
        </Link>
      );
    }
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(part)) {
      return (
        <a key={i} href={`mailto:${part}`}>
          {part}
        </a>
      );
    }
    return part;
  });
}

/**
 * Pravidla / Podmínky / Ochrana údajů (lib/legal.ts). Česky pro češtinu
 * a slovenštinu, jinak anglicky - nahoře jde přepnout.
 */
export default function LegalDoc({ doc }: { doc: Doc }) {
  const { lang } = useLanguage();
  const [version, setVersion] = useState<'cs' | 'en'>('en');
  useEffect(() => {
    setVersion(lang === 'cs' || lang === 'sk' ? 'cs' : 'en');
  }, [lang]);
  const d = doc[version];

  return (
    <article className="legal-doc">
      <div className="legal-lang" role="group" aria-label="Language">
        <button type="button" className={version === 'cs' ? 'active' : ''} aria-pressed={version === 'cs'} onClick={() => setVersion('cs')}>
          Česky
        </button>
        <button type="button" className={version === 'en' ? 'active' : ''} aria-pressed={version === 'en'} onClick={() => setVersion('en')}>
          English
        </button>
      </div>
      <h1>{d.title}</h1>
      {d.intro.map((p, i) => (
        <p key={i} className={i === 0 ? 'legal-lead' : undefined}>
          {rich(p)}
        </p>
      ))}
      {d.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          {s.paragraphs?.map((p, i) => <p key={i}>{rich(p)}</p>)}
          {s.items && (
            <ul>
              {s.items.map((item, i) => (
                <li key={i}>{rich(item)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="legal-footer">{rich(d.footer)}</p>
    </article>
  );
}
