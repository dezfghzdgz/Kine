/**
 * Oddíly Nastavení (app/settings/page.tsx). Odkaz z nabídky profilu na
 * oddíl (např. Vzhled) musí fungovat i když už je stránka nastavení
 * otevřená - Next.js změnu "#appearance" v adrese stránce neohlásí, proto
 * nabídka pošle tuhle událost.
 */
export const SETTINGS_SECTION_EVENT = 'kine-settings-section';

export function goToSettingsSection(section: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EVENT, { detail: section }));
}
