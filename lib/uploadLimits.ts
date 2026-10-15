/**
 * Limity nahrávání videí - kolik smí kdo nahrát, ať úložiště u Cloudflare
 * (platí se za každou uloženou minutu) nemůže nikdo zaplnit zadarmo.
 *
 * Čtyři stropy:
 *   - délka jednoho videa,
 *   - počet videí za posledních 24 hodin,
 *   - minuty videa za posledních 24 hodin,
 *   - celkové úložiště účtu (součet délek všech jeho videí).
 *
 * Kine Plus má všechno 3x víc (KINE_PLUS_UPLOAD_MULTIPLIER v lib/plus.ts),
 * tým Kine (moderátoři, správci) prakticky bez omezení. Nový účet (prvních
 * 24 hodin) má jako na YouTube krátká videa a jen pár denně - založit si
 * sto účtů a nahrávat z každého by se nevyplatilo.
 *
 * Hodnoty jdou změnit na Vercelu (Settings -> Environment Variables), bez
 * nového nasazení kódu stačí Redeploy:
 *   UPLOAD_DAILY_LIMIT         videí za 24 h (výchozí 20)
 *   UPLOAD_DAILY_MINUTES       minut za 24 h (výchozí 240)
 *   UPLOAD_MAX_VIDEO_MINUTES   nejdelší video v minutách (výchozí 120)
 *   UPLOAD_STORAGE_HOURS       úložiště účtu v hodinách (výchozí 30, 0 = bez stropu)
 *   UPLOAD_NEW_ACCOUNT_HOURS   jak dlouho je účet "nový" (výchozí 24, 0 = vypnuto)
 *   UPLOADS_PAUSED             1 = nouzová brzda: nikdo nic nenahraje
 *
 * Čistá logika bez databáze a bez prohlížeče (tests/uploadLimits.test.mjs).
 */

/** Cloudflare Stream přijme nejvýš 10 hodin dlouhé video. */
export const CF_MAX_DURATION_SECONDS = 36000;

/** Kine Plus: kolikrát víc (stejné číslo jako KINE_PLUS_UPLOAD_MULTIPLIER v lib/plus.ts). */
export const PLUS_UPLOAD_MULTIPLIER = 3;

export const UPLOAD_DEFAULTS = {
  perDay: 20,
  minutesPerDay: 240,
  maxVideoMinutes: 120,
  storageHours: 30,
  newAccountHours: 24,
} as const;

/** Nový účet: krátká videa a jen pár denně. */
export const NEW_ACCOUNT_LIMITS = { maxVideoMinutes: 15, perDay: 3, minutesPerDay: 45, pending: 1 } as const;

export type UploadTier = 'staff' | 'plus' | 'free' | 'new';

export type UploadLimits = {
  tier: UploadTier;
  /** Nejdelší jedno video (s). */
  maxVideoSeconds: number;
  /** Videí za posledních 24 hodin. */
  perDay: number;
  /** Sekund videa za posledních 24 hodin. */
  secondsPerDay: number;
  /** Celkové úložiště účtu (s); 0 = bez stropu. */
  storageSeconds: number;
  /** Kolik nahrávání smí být rozpracovaných naráz. */
  pending: number;
};

export type UploadUsage = {
  /** Kolikrát za posledních 24 h začal nahrávat (i nedokončené). */
  uploadsToday: number;
  /** Sekund videa za posledních 24 h (rozpracované se počítají rezervou). */
  secondsToday: number;
  /** Rozpracovaná nahrávání (ještě nepotvrzená). */
  pending: number;
  /** Jejich rezerva (s). */
  pendingSeconds: number;
  /** Součet délek videí na účtu (s). */
  storedSeconds: number;
};

export const NO_USAGE: UploadUsage = { uploadsToday: 0, secondsToday: 0, pending: 0, pendingSeconds: 0, storedSeconds: 0 };

type Env = Record<string, string | undefined>;

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegative(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type UploadWho = {
  /** Moderátor / správce (role) nebo is_admin. */
  staff: boolean;
  /** Platné Kine Plus (lib/plus.ts - hasKinePlus). */
  plus: boolean;
  /** Kdy vznikl účet (auth.users.created_at); null = nevíme (bere se jako starý účet). */
  accountCreatedAt: string | null;
};

/** Limity pro člověka podle toho, kdo je (tým / Plus / zdarma / nový účet). */
export function uploadLimitsFor(who: UploadWho, env: Env = {}, now = Date.now()): UploadLimits {
  if (who.staff) {
    return { tier: 'staff', maxVideoSeconds: CF_MAX_DURATION_SECONDS, perDay: 500, secondsPerDay: 500 * 3600, storageSeconds: 0, pending: 5 };
  }
  const perDay = Math.floor(positive(env.UPLOAD_DAILY_LIMIT, UPLOAD_DEFAULTS.perDay));
  const minutesPerDay = positive(env.UPLOAD_DAILY_MINUTES, UPLOAD_DEFAULTS.minutesPerDay);
  const maxVideoMinutes = positive(env.UPLOAD_MAX_VIDEO_MINUTES, UPLOAD_DEFAULTS.maxVideoMinutes);
  const storageHours = nonNegative(env.UPLOAD_STORAGE_HOURS, UPLOAD_DEFAULTS.storageHours);
  const newAccountHours = nonNegative(env.UPLOAD_NEW_ACCOUNT_HOURS, UPLOAD_DEFAULTS.newAccountHours);

  const created = who.accountCreatedAt ? Date.parse(who.accountCreatedAt) : NaN;
  const isNew = !who.plus && newAccountHours > 0 && Number.isFinite(created) && now - created < newAccountHours * 3600 * 1000;
  if (isNew) {
    return {
      tier: 'new',
      maxVideoSeconds: Math.min(NEW_ACCOUNT_LIMITS.maxVideoMinutes, maxVideoMinutes) * 60,
      perDay: Math.min(NEW_ACCOUNT_LIMITS.perDay, perDay),
      secondsPerDay: Math.min(NEW_ACCOUNT_LIMITS.minutesPerDay, minutesPerDay) * 60,
      storageSeconds: storageHours > 0 ? Math.round(storageHours * 3600) : 0,
      pending: NEW_ACCOUNT_LIMITS.pending,
    };
  }

  const k = who.plus ? PLUS_UPLOAD_MULTIPLIER : 1;
  return {
    tier: who.plus ? 'plus' : 'free',
    maxVideoSeconds: Math.min(CF_MAX_DURATION_SECONDS, Math.round(maxVideoMinutes * 60 * k)),
    perDay: perDay * k,
    secondsPerDay: Math.round(minutesPerDay * 60 * k),
    storageSeconds: storageHours > 0 ? Math.round(storageHours * 3600 * k) : 0,
    pending: who.plus ? 3 : 2,
  };
}

/** Nouzová brzda (UPLOADS_PAUSED=1): text pro lidi, jinak null. */
export function uploadsPaused(env: Env = {}): string | null {
  return env.UPLOADS_PAUSED === '1' || env.UPLOADS_PAUSED === 'true'
    ? 'Nahrávání videí je teď na chvíli pozastavené (údržba). Zkus to prosím později.'
    : null;
}

/**
 * "45 s", "15 min", "2 h", "1 h 30 min".
 *
 * round: 'up' pro délku videa nad limitem (video o pár sekund delší než
 * 15 min se nesmí ukázat jako "15 min" - vedle limitu "15 min" by hláška
 * nedávala smysl), 'down' pro to, co ještě zbývá (ať se neslibuje víc).
 */
export function formatDuration(seconds: number, round: 'nearest' | 'up' | 'down' = 'nearest'): string {
  const s = Math.max(0, round === 'up' ? Math.ceil(seconds) : round === 'down' ? Math.floor(seconds) : Math.round(seconds));
  if (s < 60) return `${s} s`;
  const totalMinutes = round === 'up' ? Math.ceil(s / 60) : round === 'down' ? Math.floor(s / 60) : Math.round(s / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Délka videa, kterou poslal prohlížeč / appka - jen rozumné kladné číslo, jinak null. */
export function declaredDuration(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 100 * 3600) return null;
  return n;
}

export type UploadProblem = 'too-long' | 'busy' | 'daily-count' | 'daily-minutes' | 'storage';

export type UploadCheck =
  | { ok: true; reserveSeconds: number }
  | { ok: false; code: UploadProblem; status: number; message: string };

/**
 * Smí člověk začít nahrávat? A kolik minut si u Cloudflare zarezervovat.
 *
 * Cloudflare si při založení nahrávání odečte z úložiště celou rezervu
 * (maxDurationSeconds), dokud video nedorazí. Dřív to bylo 6 hodin pro
 * každé nahrávání - pár požadavků zablokovalo celé úložiště všem. Teď je
 * rezerva délka videa (+5 % a půl minuty), kterou prohlížeč / appka zná
 * z metadat souboru; když ji nezná, strop délky videa. Delší video, než
 * kolik bylo ohlášeno, Cloudflare odmítne zpracovat.
 */
export function checkUpload(limits: UploadLimits, usage: UploadUsage, declaredSeconds: number | null): UploadCheck {
  const declared = declaredSeconds !== null && Number.isFinite(declaredSeconds) && declaredSeconds > 0 ? declaredSeconds : null;

  if (declared !== null && declared > limits.maxVideoSeconds + 1) {
    const message =
      limits.tier === 'new'
        ? `Nový účet může první den nahrávat videa nejvýš do ${formatDuration(limits.maxVideoSeconds)}. Delší video půjde nahrát zítra.`
        : `Video je moc dlouhé - nejvýš ${formatDuration(limits.maxVideoSeconds)}.`;
    return { ok: false, code: 'too-long', status: 413, message };
  }

  if (usage.pending >= limits.pending) {
    return {
      ok: false,
      code: 'busy',
      status: 429,
      message: limits.pending === 1 ? 'Jedno video se ti už nahrává - počkej, až se dokončí.' : `Nahráváš už ${usage.pending} videa naráz - počkej, až se některé dokončí.`,
    };
  }

  if (usage.uploadsToday >= limits.perDay) {
    return {
      ok: false,
      code: 'daily-count',
      status: 429,
      message: `Za posledních 24 hodin jsi nahrál/a ${usage.uploadsToday} videí (limit je ${limits.perDay}). Zkus to prosím později.`,
    };
  }

  let reserve = declared !== null ? Math.min(limits.maxVideoSeconds, Math.ceil(declared * 1.05) + 30) : limits.maxVideoSeconds;

  const leftToday = limits.secondsPerDay - usage.secondsToday;
  if (declared !== null ? declared > leftToday : leftToday < 60) {
    return {
      ok: false,
      code: 'daily-minutes',
      status: 429,
      message:
        leftToday >= 60
          ? `Za posledních 24 hodin ti zbývá nahrát už jen ${formatDuration(leftToday, 'down')} videa (limit ${formatDuration(limits.secondsPerDay)}). Kratší video půjde hned, delší později.`
          : `Za posledních 24 hodin jsi nahrál/a ${formatDuration(usage.secondsToday)} videa (limit ${formatDuration(limits.secondsPerDay)}). Zkus to prosím později.`,
    };
  }
  // Délku nezná (exotický formát): rezerva jen do toho, co dnes zbývá.
  if (declared === null) reserve = Math.min(reserve, Math.floor(leftToday));

  if (limits.storageSeconds > 0) {
    const leftStorage = limits.storageSeconds - usage.storedSeconds - usage.pendingSeconds;
    if (declared !== null ? declared > leftStorage : leftStorage < 60) {
      return {
        ok: false,
        code: 'storage',
        status: 507,
        message:
          leftStorage >= 60
            ? `Na tohle video už v úložišti kanálu není místo - zbývá ${formatDuration(leftStorage, 'down')} z ${formatDuration(limits.storageSeconds)}. Smaž starší videa, ať se uvolní místo.`
            : `Úložiště tvého kanálu je plné (${formatDuration(usage.storedSeconds)} z ${formatDuration(limits.storageSeconds)}). Smaž starší videa, ať se uvolní místo.`,
      };
    }
    if (declared === null) reserve = Math.min(reserve, Math.floor(leftStorage));
  }

  reserve = Math.max(60, Math.min(CF_MAX_DURATION_SECONDS, Math.round(reserve)));
  return { ok: true, reserveSeconds: reserve };
}

/** Co ukázat na stránce nahrávání (zbývá dnes, úložiště). */
export function uploadSummary(limits: UploadLimits, usage: UploadUsage) {
  return {
    tier: limits.tier,
    maxVideoSeconds: limits.maxVideoSeconds,
    perDay: limits.perDay,
    uploadsToday: usage.uploadsToday,
    secondsPerDay: limits.secondsPerDay,
    secondsToday: usage.secondsToday,
    storageSeconds: limits.storageSeconds,
    storedSeconds: usage.storedSeconds,
  };
}
