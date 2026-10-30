'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import type { LegalDoc as Doc } from '@/lib/legal';

/** Odkazy v textu (/rules, /copyright...) jako opravdové odkazy, e-mail jako mailto. */
function rich(text: string) {
  const parts = text.split(/(\/(?:rules|terms|privacy|copyright|plus|settings|donate)\b|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g);
  return parts.map((part, i) => {
    if (/^\/(rules|terms|privacy|copyright|plus|settings|donate)$/.test(part)) {
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
 *
 * Delší dokumenty mají nahoře „Ve zkratce“ (shrnutí pro rychlou orientaci),
 * obsah s odkazy na články a číslované odstavce (1.1, 1.2…), na které jde
 * odkazovat (#cl-3 = článek 3).
 */
export default function LegalDoc({ doc }: { doc: Doc }) {
  const { lang } = useLanguage();
  const [version, setVersion] = useState<'cs' | 'en'>('en');
  useEffect(() => {
    setVersion(lang === 'cs' || lang === 'sk' ? 'cs' : 'en');
  }, [lang]);
  const d = doc[version];
  const cs = version === 'cs';
  const num = (i: number) => (d.numbered ? `${i + 1}. ` : '');

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

      {d.summary && d.summary.length > 0 && (
        <aside className="legal-summary" aria-label={cs ? 'Ve zkratce' : 'In short'}>
          <p className="legal-summary-title">{cs ? 'Ve zkratce' : 'In short'}</p>
          <ul>
            {d.summary.map((item, i) => (
              <li key={i}>{rich(item)}</li>
            ))}
          </ul>
          <p className="legal-summary-note">
            {cs ? 'Shrnutí slouží jen pro rychlou orientaci - závazný je celý text níže.' : 'This summary is only for quick orientation - the full text below is binding.'}
          </p>
        </aside>
      )}

      {d.sections.length >= 6 && (
        <nav className="legal-toc" aria-label={cs ? 'Obsah' : 'Contents'}>
          <p className="legal-toc-title">{cs ? 'Obsah' : 'Contents'}</p>
          <ol>
            {d.sections.map((s, i) => (
              <li key={s.heading}>
                <a href={`#cl-${i + 1}`}>
                  {num(i)}
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {d.sections.map((s, i) => (
        <section key={s.heading} id={`cl-${i + 1}`}>
          <h2>
            {num(i)}
            {s.heading}
          </h2>
          {s.paragraphs?.map((p, j) => <p key={j}>{rich(p)}</p>)}
          {s.items &&
            (d.numbered ? (
              <ol className="legal-clauses">
                {s.items.map((item, j) => (
                  <li key={j} data-num={`${i + 1}.${j + 1}`}>
                    {rich(item)}
                  </li>
                ))}
              </ol>
            ) : (
              <ul>
                {s.items.map((item, j) => (
                  <li key={j}>{rich(item)}</li>
                ))}
              </ul>
            ))}
        </section>
      ))}
      <p className="legal-footer">{rich(d.footer)}</p>
    </article>
  );
}
