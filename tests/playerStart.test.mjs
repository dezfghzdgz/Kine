/**
 * Test rozjezdu přehrávače (lib/playerStart.ts).
 *
 * Cloudflare se z tohohle prostředí nedá zavolat, takže se přehrávač
 * napodobuje: umí říct, kdy je připravený, a jinak povely zahazuje -
 * přesně jako iframe, který ještě nedoběhl.
 *
 * Spustit:  node tests/playerStart.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/playerStart.ts');
const { startPlayback, ATTEMPT_SCHEDULE, OFFER_TAP_AFTER_MS, SEEK_TOLERANCE_S } =
  await import(join(kam, 'playerStart.js'));

/** Ruční hodiny - test neběží v reálném čase. */
function hodiny() {
  let ted = 0;
  let dalsiId = 1;
  const naplanovane = new Map();

  return {
    timers: {
      setTimeout(fn, ms) {
        const id = dalsiId++;
        naplanovane.set(id, { kdy: ted + ms, fn });
        return id;
      },
      clearTimeout(id) {
        naplanovane.delete(id);
      },
    },
    /** Posune čas a spustí všechno, co po cestě mělo proběhnout. */
    posun(ms) {
      const cil = ted + ms;
      while (true) {
        const dalsi = [...naplanovane.entries()]
          .filter(([, u]) => u.kdy <= cil)
          .sort((a, b) => a[1].kdy - b[1].kdy)[0];
        if (!dalsi) break;
        const [id, uloha] = dalsi;
        naplanovane.delete(id);
        ted = uloha.kdy;
        uloha.fn();
      }
      ted = cil;
    },
    get cas() {
      return ted;
    },
    get pocetNaplanovanych() {
      return naplanovane.size;
    },
  };
}

/**
 * Napodobenina přehrávače Cloudflare.
 *
 * Dokud není `pripravenOd`, zahazuje všechno - jako iframe, do kterého
 * zpráva nemá kam dojít.
 */
function prehravac({ pripravenOd = 0, hlasiUdalosti = true, h }) {
  const posluchaci = {};
  const p = {
    currentTime: 0,
    paused: true,
    pokusyOPlay: 0,
    pokusyOSeek: 0,
    addEventListener(ev, fn) {
      (posluchaci[ev] ??= []).push(fn);
    },
    removeEventListener(ev, fn) {
      posluchaci[ev] = (posluchaci[ev] ?? []).filter((f) => f !== fn);
    },
    play() {
      p.pokusyOPlay++;
      if (h.cas < pripravenOd) return; // zpráva se ztratila
      if (p.paused) {
        p.paused = false;
        (posluchaci.play ?? []).forEach((fn) => fn());
      }
    },
    set currentTimeSetter(v) {},
    emit(ev) {
      (posluchaci[ev] ?? []).forEach((fn) => fn());
    },
    get maPosluchace() {
      return Object.values(posluchaci).some((l) => l.length > 0);
    },
  };

  let cas = 0;
  Object.defineProperty(p, 'currentTime', {
    get: () => cas,
    set: (v) => {
      p.pokusyOSeek++;
      if (h.cas < pripravenOd) return; // převinutí se taky ztratí
      cas = v;
    },
  });

  // Přehrávač, který se ozve sám, jakmile je připravený.
  if (hlasiUdalosti && pripravenOd > 0) {
    h.timers.setTimeout(() => p.emit('canplay'), pripravenOd);
  }

  return p;
}

let prosly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------

test('iframe připravený hned - přehraje se', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 0, h });
  let started = false;
  startPlayback({ player: p, isCurrent: () => true, onStarted: () => (started = true), timers: h.timers });
  h.posun(10);
  assert.equal(p.paused, false);
  assert.equal(started, true);
});

test('iframe se rozjede až po 7 vteřinách - stará verze to vzdala po 3, tahle ne', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 7000, h });
  let started = false;
  startPlayback({ player: p, isCurrent: () => true, onStarted: () => (started = true), timers: h.timers });

  h.posun(3000);
  assert.equal(p.paused, true, 've 3. vteřině ještě opravdu nehraje');

  h.posun(20000);
  assert.equal(p.paused, false, 'po sedmé vteřině se to musí rozjet');
  assert.equal(started, true);
});

test('rozjezd i po 13 vteřinách (pomalé připojení)', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 12500, h });
  startPlayback({ player: p, isCurrent: () => true, timers: h.timers });
  h.posun(30000);
  assert.equal(p.paused, false);
});

test('přehrávač se ohlásí sám - reaguje se na událost, ne až na další pokus', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 5000, hlasiUdalosti: true, h });
  startPlayback({ player: p, isCurrent: () => true, timers: h.timers });
  // Nejbližší plánovaný pokus po 5 s je až v 6 s. Když se to rozjelo
  // dřív, znamená to, že zabrala událost canplay.
  h.posun(5000);
  assert.equal(p.paused, false, 'událost canplay musí rozjezd spustit hned');
});

test('když se to nerozjede, po 4 vteřinách se nabídne tlačítko', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: Infinity, h });
  let nabidnuto = false;
  startPlayback({ player: p, isCurrent: () => true, onNeedsTap: () => (nabidnuto = true), timers: h.timers });

  h.posun(OFFER_TAP_AFTER_MS - 100);
  assert.equal(nabidnuto, false, 'dřív než za 4 s se tlačítko nabízet nemá');

  h.posun(200);
  assert.equal(nabidnuto, true);
});

test('rozjelo-li se to včas, tlačítko se nenabídne', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 1000, h });
  let nabidnuto = false;
  startPlayback({ player: p, isCurrent: () => true, onNeedsTap: () => (nabidnuto = true), timers: h.timers });
  h.posun(20000);
  assert.equal(nabidnuto, false);
});

test('předání času: převine se, ale ne pořád dokola', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 2000, h });
  startPlayback({ player: p, seekTo: 61, isCurrent: () => true, timers: h.timers });
  h.posun(20000);

  assert.equal(p.paused, false);
  assert.ok(Math.abs(p.currentTime - 61) <= SEEK_TOLERANCE_S, 'čas se má přenést: ' + p.currentTime);
  // Stará verze převíjela při každém pokusu a tím pokaždé zahodila, co se
  // stihlo načíst. Po úspěšném převinutí se už převíjet nesmí.
  assert.ok(p.pokusyOSeek <= ATTEMPT_SCHEDULE.length, 'zbytečné převíjení: ' + p.pokusyOSeek);
});

test('bez předání času se nepřevíjí vůbec', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 500, h });
  startPlayback({ player: p, isCurrent: () => true, timers: h.timers });
  h.posun(20000);
  assert.equal(p.pokusyOSeek, 0);
});

test('výměna přehrávače uprostřed - do starého se už nešahá', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 9000, h });
  let aktualni = true;
  startPlayback({ player: p, isCurrent: () => aktualni, timers: h.timers });

  h.posun(1000);
  const pokusyPred = p.pokusyOPlay;
  aktualni = false;
  h.posun(20000);

  // Pokus, který výměnu zjistí, se do přehrávače vůbec netrefí - nejdřív
  // se ptá, jestli je pořád aktuální. Počet volání play() proto zůstane.
  assert.equal(p.pokusyOPlay, pokusyPred, 'do vyměněného přehrávače se už nesmí sáhnout');
  assert.equal(p.paused, true);
});

test('úklid zruší všechny naplánované pokusy i posluchače', () => {
  const h = hodiny();
  // hlasiUdalosti: false, ať si napodobenina nenaplánuje vlastní časovač -
  // počítají se jen ty, které založil rozjezd.
  const p = prehravac({ pripravenOd: 9000, hlasiUdalosti: false, h });
  const cleanup = startPlayback({ player: p, isCurrent: () => true, timers: h.timers });

  h.posun(500);
  assert.ok(h.pocetNaplanovanych > 0);
  cleanup();

  assert.equal(h.pocetNaplanovanych, 0, 'nesmí zůstat viset časovač');
  assert.equal(p.maPosluchace, false, 'nesmí zůstat viset posluchač');
});

test('úklid dvakrát za sebou nevadí', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 0, h });
  const cleanup = startPlayback({ player: p, isCurrent: () => true, timers: h.timers });
  cleanup();
  cleanup();
});

test('po rozjetí se přestane zkoušet', () => {
  const h = hodiny();
  const p = prehravac({ pripravenOd: 0, h });
  startPlayback({ player: p, isCurrent: () => true, timers: h.timers });
  h.posun(100);
  const pokusy = p.pokusyOPlay;
  h.posun(20000);
  assert.equal(p.pokusyOPlay, pokusy, 'po rozjetí se už nemá bušit do přehrávače');
  assert.equal(h.pocetNaplanovanych, 0);
});

test('přehrávač, který neumí addEventListener, to nepoloží', () => {
  const h = hodiny();
  const holy = { paused: true, play() { holy.paused = false; } };
  startPlayback({ player: holy, isCurrent: () => true, timers: h.timers });
  h.posun(10);
  assert.equal(holy.paused, false);
});

test('výjimka při převíjení rozjezd nezastaví', () => {
  const h = hodiny();
  let cas = 0;
  const zlobivy = {
    paused: true,
    get currentTime() { return cas; },
    set currentTime(v) { throw new Error('iframe ještě neposlouchá'); },
    play() { zlobivy.paused = false; },
  };
  startPlayback({ player: zlobivy, seekTo: 30, isCurrent: () => true, timers: h.timers });
  h.posun(20000);
  assert.equal(zlobivy.paused, false, 'play se musí zavolat i když převinutí spadlo');
});

console.log('\n' + prosly + ' kontrol prošlo');
