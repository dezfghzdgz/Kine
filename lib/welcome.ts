/**
 * Průvodce po první registraci (app/welcome/page.tsx): pořadí kroků a kde
 * začít, když už je něco vyplněné (třeba z jiného zařízení). Čisté - má
 * test (tests/welcome.test.mjs).
 */

export type WelcomeStep = 'rules' | 'purpose' | 'rating' | 'content' | 'done';

export const WELCOME_STEPS: readonly WelcomeStep[] = ['rules', 'purpose', 'rating', 'content', 'done'];

export type WelcomeProfile = {
  agreedToRules: boolean;
  viewerType: string | null;
  ratingMode: string | null;
  contentPreference: string | null;
};

/** První nevyplněný krok; 'done' = všechno hotové. */
export function firstWelcomeStep(p: WelcomeProfile): WelcomeStep {
  if (!p.agreedToRules) return 'rules';
  if (!p.viewerType) return 'purpose';
  if (!p.ratingMode) return 'rating';
  if (!p.contentPreference) return 'content';
  return 'done';
}

/** Potřebuje člověk po přihlášení průvodce? (login, registrace) */
export function needsWelcome(p: WelcomeProfile): boolean {
  return firstWelcomeStep(p) !== 'done';
}
