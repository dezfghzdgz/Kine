'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';

/**
 * Klávesové zkratky pro celou appku.
 *
 *   /        otevře hledání nahoře
 *   j / k    posun mezi kartami videí (jako v poště nebo na Redditu)
 *   Enter    otevře vybrané video
 *   Esc      zruší výběr, případně zavře tenhle přehled
 *   ?        ukáže/schová přehled zkratek
 *
 * Výběr se schválně drží přímo v DOMu (třídou na kartě), ne ve state.
 * Karty rozdává několik různých stránek a žádná z nich by o výběru
 * nemusela vědět - takhle zkratky fungují všude a nikde se kvůli nim
 * nemusí nic předávat dolů.
 */

export const OPEN_SEARCH_EVENT = 'kine-open-search';

const CARD_SELECTOR = '.video-card-interactive';
const FOCUS_CLASS = 'video-card-keyboard-focus';

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/** Enter má patřit tomu, na čem divák zrovna stojí - tlačítku, odkazu, poli. */
function focusIsIdle() {
  const active = document.activeElement;
  return !active || active === document.body;
}

function cards() {
  return Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR));
}

function clearFocus() {
  cards().forEach((card) => card.classList.remove(FOCUS_CLASS));
}

function moveFocus(delta: number) {
  const list = cards();
  if (list.length === 0) return;

  const current = list.findIndex((card) => card.classList.contains(FOCUS_CLASS));
  // První stisk "j" vybere první kartu, první "k" tu poslední.
  const start = current === -1 ? (delta > 0 ? -1 : list.length) : current;
  const next = Math.max(0, Math.min(list.length - 1, start + delta));

  list.forEach((card) => card.classList.remove(FOCUS_CLASS));
  list[next].classList.add(FOCUS_CLASS);
  list[next].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function openFocused() {
  const focused = cards().find((card) => card.classList.contains(FOCUS_CLASS));
  const link = focused?.querySelector<HTMLAnchorElement>('a.video-card-link');
  link?.click();
}

export default function KeyboardShortcuts({ cardNavigation = true }: { cardNavigation?: boolean }) {
  const { t } = useLanguage();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // Ctrl/Cmd+K jako druhá cesta k hledání. Na české klávesnici se "/"
      // píše přes AltGr, takže samotné lomítko by pro spoustu lidí bylo
      // spíš překážka než zkratka.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
        return;
      }

      // Windows hlásí AltGr jako Ctrl+Alt. Kdyby se to bralo jako obyčejnou
      // kombinaci s Ctrl, znaky psané přes AltGr (mimo jiné právě "/") by
      // sem nikdy nedorazily.
      const altGr = e.ctrlKey && e.altKey;
      if ((e.metaKey || e.ctrlKey || e.altKey) && !altGr) return;

      switch (e.key) {
        case '/':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
          break;
        case '?':
          e.preventDefault();
          setHelpOpen((open) => !open);
          break;
        case 'j':
          if (!cardNavigation) break;
          e.preventDefault();
          moveFocus(1);
          break;
        case 'k':
          if (!cardNavigation) break;
          e.preventDefault();
          moveFocus(-1);
          break;
        case 'Enter':
          if (cardNavigation && focusIsIdle()) openFocused();
          break;
        case 'Escape':
          setHelpOpen(false);
          clearFocus();
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cardNavigation]);

  if (!helpOpen) return null;

  const rows: [string, string][] = [
    ['/  ·  Ctrl K', t('shortcutsSearch')],
    ...(cardNavigation
      ? ([
          ['J', t('shortcutsNext')],
          ['K', t('shortcutsPrev')],
          ['Enter', t('shortcutsOpen')],
        ] as [string, string][])
      : []),
    ['Esc', t('shortcutsClose')],
    ['?', t('shortcutsToggle')],
  ];

  return (
    <div className="shortcuts-backdrop" onClick={() => setHelpOpen(false)} role="presentation">
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <p className="shortcuts-title">{t('shortcutsTitle')}</p>
        <ul className="shortcuts-list">
          {rows.map(([key, label]) => (
            <li key={key}>
              <kbd>{key}</kbd>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
