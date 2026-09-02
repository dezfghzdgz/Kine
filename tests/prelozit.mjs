/**
 * Přeloží testovaný TypeScript na JavaScript, aby ho šlo v testu spustit.
 *
 * Dřív jsem typy odstraňoval regulárními výrazy. Fungovalo to, dokud se
 * v souboru neobjevil typ, na který jsem nemyslel - test pak spadl na
 * syntaxi a vypadalo to jako chyba v kódu. Tohle použije skutečný
 * překladač, takže na tom nezáleží.
 *
 * Chyby překladu se schválně ignorují: typy zkontroluje "tsc" nad celým
 * projektem, tady jde jen o spustitelný JavaScript.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TSC = process.env.TSC ?? 'tsc';

export function prelozit(...relativniCesty) {
  const korenRepa = fileURLToPath(new URL('..', import.meta.url));
  const kam = mkdtempSync(join(tmpdir(), 'kine-test-'));

  try {
    execFileSync(
      TSC,
      [
        ...relativniCesty,
        '--ignoreConfig',
        '--outDir', kam,
        '--target', 'es2022',
        '--module', 'esnext',
        '--moduleResolution', 'bundler',
        '--skipLibCheck',
      ],
      { cwd: korenRepa, stdio: 'pipe' }
    );
  } catch {
    // Překladač si stěžuje na typy z Reactu, které tu nejsou nainstalované.
    // JavaScript i tak vygeneruje a o ten nám jde.
  }

  return kam;
}
