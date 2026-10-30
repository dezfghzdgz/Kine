/**
 * Na kterou stranu otevřít nabídku pod tlačítkem, aby nevyjela z okna.
 *
 * Nabídky (zvoneček u odběru, sdílení…) se otevíraly vždy doprava od
 * tlačítka - u pravého okraje (velké okno, celá obrazovka) pak půlka
 * nabídky zmizela za okrajem. Když se doprava nevejde, zarovná se
 * k pravému okraji tlačítka a otevře doleva.
 */
export type DropdownSide = 'left' | 'right';

/** Čistý výpočet (test): `anchorLeft` = levý okraj obalu tlačítka, `width` = šířka nabídky. */
export function sideFor(anchorLeft: number, anchorRight: number, width: number, viewportWidth: number, margin = 8): DropdownSide {
  if (anchorLeft + width <= viewportWidth - margin) return 'left';
  // Doleva od pravého okraje tlačítka - jen když se tam vejde líp než doprava.
  return anchorRight - width >= margin || anchorRight - width > viewportWidth - margin - (anchorLeft + width) ? 'right' : 'left';
}

/** Strana pro prvek v prohlížeči (obal tlačítka s position: relative). */
export function dropdownSide(anchor: Element | null, width: number): DropdownSide {
  if (!anchor || typeof window === 'undefined') return 'left';
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  return sideFor(r.left, r.right, width, vw);
}
