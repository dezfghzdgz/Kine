/**
 * Texty push oznámení v jazyce zařízení (jazyk si zařízení uloží při
 * zapnutí oznámení). Oznámení ve zvonečku zůstávají, jak jsou - tohle je
 * jen to, co vyskočí na telefonu / v systému.
 */

export const PUSH_LANGS = ['cs', 'sk', 'en', 'de', 'es', 'fr', 'pl', 'uk'] as const;
export type PushLang = (typeof PUSH_LANGS)[number];

type Texts = {
  liveTitle: string;
  liveBody: string;
  videoTitle: string;
  postTitle: string;
  postMembers: string;
  replyTitle: string;
  replyBody: string;
  collabTitle: string;
  tipTitle: string;
  tipBody: string;
  adminTitle: string;
  testTitle: string;
  testBody: string;
};

const T: Record<PushLang, Texts> = {
  cs: {
    liveTitle: '🔴 {name} je živě',
    liveBody: 'Přijď se podívat.',
    videoTitle: 'Nové video od {name}',
    postTitle: 'Nový příspěvek od {name}',
    postMembers: '🔒 Příspěvek pro členy',
    replyTitle: 'Nový komentář od {name}',
    replyBody: 'Klepni a přečti si ho.',
    collabTitle: '{name} tě zve ke spolupráci',
    tipTitle: '💛 Nová podpora',
    tipBody: 'Otevři Kine a podívej se, kdo ji poslal.',
    adminTitle: 'Kine - upozornění',
    testTitle: 'Kine',
    testBody: 'Oznámení fungují 👍',
  },
  sk: {
    liveTitle: '🔴 {name} je naživo',
    liveBody: 'Príď sa pozrieť.',
    videoTitle: 'Nové video od {name}',
    postTitle: 'Nový príspevok od {name}',
    postMembers: '🔒 Príspevok pre členov',
    replyTitle: 'Nový komentár od {name}',
    replyBody: 'Ťukni a prečítaj si ho.',
    collabTitle: '{name} ťa pozýva na spoluprácu',
    tipTitle: '💛 Nová podpora',
    tipBody: 'Otvor Kine a pozri sa, kto ju poslal.',
    adminTitle: 'Kine - upozornenie',
    testTitle: 'Kine',
    testBody: 'Upozornenia fungujú 👍',
  },
  en: {
    liveTitle: '🔴 {name} is live',
    liveBody: 'Come and watch.',
    videoTitle: 'New video from {name}',
    postTitle: 'New post from {name}',
    postMembers: '🔒 Members-only post',
    replyTitle: 'New comment from {name}',
    replyBody: 'Tap to read it.',
    collabTitle: '{name} invited you to collaborate',
    tipTitle: '💛 New tip',
    tipBody: 'Open Kine to see who sent it.',
    adminTitle: 'Kine - alert',
    testTitle: 'Kine',
    testBody: 'Notifications work 👍',
  },
  de: {
    liveTitle: '🔴 {name} ist live',
    liveBody: 'Schau vorbei.',
    videoTitle: 'Neues Video von {name}',
    postTitle: 'Neuer Beitrag von {name}',
    postMembers: '🔒 Beitrag nur für Mitglieder',
    replyTitle: 'Neuer Kommentar von {name}',
    replyBody: 'Tippe, um ihn zu lesen.',
    collabTitle: '{name} lädt dich zur Zusammenarbeit ein',
    tipTitle: '💛 Neuer Tip',
    tipBody: 'Öffne Kine, um zu sehen, wer ihn geschickt hat.',
    adminTitle: 'Kine - Warnung',
    testTitle: 'Kine',
    testBody: 'Benachrichtigungen funktionieren 👍',
  },
  es: {
    liveTitle: '🔴 {name} está en directo',
    liveBody: 'Ven a verlo.',
    videoTitle: 'Nuevo vídeo de {name}',
    postTitle: 'Nueva publicación de {name}',
    postMembers: '🔒 Publicación solo para miembros',
    replyTitle: 'Nuevo comentario de {name}',
    replyBody: 'Toca para leerlo.',
    collabTitle: '{name} te invita a colaborar',
    tipTitle: '💛 Nueva propina',
    tipBody: 'Abre Kine para ver quién la envió.',
    adminTitle: 'Kine - aviso',
    testTitle: 'Kine',
    testBody: 'Las notificaciones funcionan 👍',
  },
  fr: {
    liveTitle: '🔴 {name} est en live',
    liveBody: 'Viens regarder.',
    videoTitle: 'Nouvelle vidéo de {name}',
    postTitle: 'Nouveau post de {name}',
    postMembers: '🔒 Post réservé aux membres',
    replyTitle: 'Nouveau commentaire de {name}',
    replyBody: 'Touche pour le lire.',
    collabTitle: '{name} t’invite à collaborer',
    tipTitle: '💛 Nouveau tip',
    tipBody: 'Ouvre Kine pour voir qui l’a envoyé.',
    adminTitle: 'Kine - alerte',
    testTitle: 'Kine',
    testBody: 'Les notifications fonctionnent 👍',
  },
  pl: {
    liveTitle: '🔴 {name} nadaje na żywo',
    liveBody: 'Wpadnij obejrzeć.',
    videoTitle: 'Nowy film od {name}',
    postTitle: 'Nowy post od {name}',
    postMembers: '🔒 Post tylko dla członków',
    replyTitle: 'Nowy komentarz od {name}',
    replyBody: 'Dotknij, aby przeczytać.',
    collabTitle: '{name} zaprasza cię do współpracy',
    tipTitle: '💛 Nowy napiwek',
    tipBody: 'Otwórz Kine i zobacz, kto go wysłał.',
    adminTitle: 'Kine - ostrzeżenie',
    testTitle: 'Kine',
    testBody: 'Powiadomienia działają 👍',
  },
  uk: {
    liveTitle: '🔴 {name} в ефірі',
    liveBody: 'Заходь подивитися.',
    videoTitle: 'Нове відео від {name}',
    postTitle: 'Новий допис від {name}',
    postMembers: '🔒 Допис лише для учасників',
    replyTitle: 'Новий коментар від {name}',
    replyBody: 'Торкнися, щоб прочитати.',
    collabTitle: '{name} запрошує тебе до співпраці',
    tipTitle: '💛 Новий донат',
    tipBody: 'Відкрий Kine, щоб побачити, хто його надіслав.',
    adminTitle: 'Kine - попередження',
    testTitle: 'Kine',
    testBody: 'Сповіщення працюють 👍',
  },
};

export function isPushLang(value: unknown): value is PushLang {
  return typeof value === 'string' && (PUSH_LANGS as readonly string[]).includes(value);
}

/** Text v jazyce zařízení; {name} se nahradí (zkrácené jméno). */
export function pushText(lang: string, key: keyof Texts, vars: Record<string, string> = {}): string {
  const dict = T[isPushLang(lang) ? lang : 'en'];
  return dict[key].replace(/\{(\w+)\}/g, (_, k) => clip(vars[k] ?? '', 40));
}

/** Zkrácení na `max` znaků (bez půlených emoji), s výpustkou. */
export function clip(text: string, max: number): string {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : chars.join('');
}
