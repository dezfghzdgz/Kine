/**
 * Test nahrávání po částech (lib/tusUpload.ts).
 *
 * Cloudflare se odsud volat nedá, tak si tu stojí jeho napodobenina:
 * server, který přijímá kusy, hlídá pořadí a umí selhat přesně tam, kde
 * chceme. Zajímá nás hlavně to, co v appce nefungovalo - velký soubor,
 * který uprostřed skončil chybou a začínal se celý znovu.
 *
 * Spustit:  node tests/tusUpload.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/tusUpload.ts');
const { uploadResumable, TusError, TUS_CHUNK_SIZE, RESUMABLE_FROM_BYTES, base64Ascii } = await import(
  join(kam, 'tusUpload.js')
);

/** Soubor: stačí, aby uměl size a slice. */
function soubor(size) {
  return {
    size,
    slice(od, do_) {
      return { od, do: do_, size: do_ - od };
    },
  };
}

/**
 * Napodobenina Cloudflare.
 *
 * selzeNa: seznam pořadových čísel pokusů, které mají selhat.
 * zapominaOffset: server nevrací hlavičku Upload-Offset (prohlížeč ji
 * u cizí domény vidět nemusí).
 */
function server({ selzeNa = [], zapominaOffset = false, tvrdaChyba = null, ztratiSpojeni = [] } = {}) {
  const stav = { offset: 0, pokusy: 0, patch: 0, head: 0, prijatePorady: [] };

  const doFetch = async (url, init) => {
    if (init.method === 'HEAD') {
      stav.head++;
      return {
        ok: true,
        status: 200,
        headers: new Map([['Upload-Offset', String(stav.offset)]]),
      };
    }

    stav.pokusy++;
    const poslanyOffset = Number(init.headers['Upload-Offset']);

    if (ztratiSpojeni.includes(stav.pokusy)) throw new Error('Failed to fetch');

    if (tvrdaChyba && stav.pokusy === tvrdaChyba.pokus) {
      return { ok: false, status: tvrdaChyba.status, headers: new Map() };
    }

    if (selzeNa.includes(stav.pokusy)) {
      return { ok: false, status: 500, headers: new Map() };
    }

    // Kus, který nenavazuje, server odmítne - jako opravdový tus.
    if (poslanyOffset !== stav.offset) {
      return { ok: false, status: 409, headers: new Map() };
    }

    stav.patch++;
    stav.prijatePorady.push(poslanyOffset);
    stav.offset = poslanyOffset + init.body.size;

    return {
      ok: true,
      status: 204,
      headers: new Map(zapominaOffset ? [] : [['Upload-Offset', String(stav.offset)]]),
    };
  };

  // headers.get() jako u skutečné odpovědi
  const puvodni = doFetch;
  const obal = async (...args) => {
    const res = await puvodni(...args);
    return { ...res, headers: { get: (k) => res.headers.get(k) ?? null } };
  };

  return { stav, doFetch: obal };
}

const hnedTed = async () => {};

let prosly = 0;
async function test(nazev, fn) {
  try {
    await fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------

await test('malý soubor projde jedním kusem', async () => {
  const s = server();
  await uploadResumable({ url: 'u', file: soubor(1000), fetchImpl: s.doFetch, sleep: hnedTed });
  assert.equal(s.stav.patch, 1);
  assert.equal(s.stav.offset, 1000);
});

await test('velký soubor se rozdělí a dojde celý', async () => {
  const s = server();
  const velikost = TUS_CHUNK_SIZE * 3 + 12345;
  await uploadResumable({ url: 'u', file: soubor(velikost), fetchImpl: s.doFetch, sleep: hnedTed });
  assert.equal(s.stav.offset, velikost, 'musí dojít úplně všechno');
  assert.equal(s.stav.patch, 4);
});

await test('kusy jdou v pořadí a nic se nepřeskočí', async () => {
  const s = server();
  await uploadResumable({
    url: 'u',
    file: soubor(TUS_CHUNK_SIZE * 3),
    fetchImpl: s.doFetch,
    sleep: hnedTed,
  });
  assert.deepEqual(s.stav.prijatePorady, [0, TUS_CHUNK_SIZE, TUS_CHUNK_SIZE * 2]);
});

await test('výpadek uprostřed: pokračuje se, ne od začátku', async () => {
  // Tohle je přesně ten případ z appky - jen se to dřív rovnou vzdalo.
  const s = server({ selzeNa: [2] });
  const velikost = TUS_CHUNK_SIZE * 3;
  await uploadResumable({ url: 'u', file: soubor(velikost), fetchImpl: s.doFetch, sleep: hnedTed });

  assert.equal(s.stav.offset, velikost, 'nahrávání musí doběhnout');
  assert.equal(s.stav.prijatePorady[0], 0);
  assert.ok(
    !s.stav.prijatePorady.slice(1).includes(0),
    'první kus se nesmí posílat znovu - to by bylo začínání od nuly'
  );
});

await test('ztracené spojení se taky přežije', async () => {
  const s = server({ ztratiSpojeni: [2, 3] });
  const velikost = TUS_CHUNK_SIZE * 2;
  await uploadResumable({ url: 'u', file: soubor(velikost), fetchImpl: s.doFetch, sleep: hnedTed });
  assert.equal(s.stav.offset, velikost);
});

await test('po neúspěchu se appka zeptá, kolik toho druhá strana má', async () => {
  const s = server({ selzeNa: [2] });
  await uploadResumable({
    url: 'u',
    file: soubor(TUS_CHUNK_SIZE * 2),
    fetchImpl: s.doFetch,
    sleep: hnedTed,
  });
  assert.ok(s.stav.head >= 1, 'bez dotazu by se poslal kus, který už tam je');
});

await test('když prohlížeč hlavičku nevidí, jede se podle vlastního počítadla', async () => {
  const s = server({ zapominaOffset: true });
  const velikost = TUS_CHUNK_SIZE * 2 + 500;
  await uploadResumable({ url: 'u', file: soubor(velikost), fetchImpl: s.doFetch, sleep: hnedTed });
  assert.equal(s.stav.offset, velikost);
});

await test('trvalé odmítnutí se nezkouší donekonečna', async () => {
  const s = server({ selzeNa: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  await assert.rejects(
    () =>
      uploadResumable({
        url: 'u',
        file: soubor(TUS_CHUNK_SIZE * 2),
        fetchImpl: s.doFetch,
        sleep: hnedTed,
        maxRetries: 3,
      }),
    (e) => e.name === 'TusError'
  );
  assert.ok(s.stav.pokusy <= 5, 'pokusů má být pár, ne nekonečno: ' + s.stav.pokusy);
});

await test('chybu, kterou opakování nespraví, appka nezkouší znovu', async () => {
  const s = server({ tvrdaChyba: { pokus: 1, status: 413 } });
  await assert.rejects(
    () => uploadResumable({ url: 'u', file: soubor(TUS_CHUNK_SIZE * 2), fetchImpl: s.doFetch, sleep: hnedTed }),
    (e) => e instanceof Error && String(e.message).includes('413')
  );
  assert.equal(s.stav.pokusy, 1, 'po 413 nemá cenu posílat to samé znovu');
});

await test('postup jde od nuly do sta a nikdy zpátky', async () => {
  const s = server();
  const videno = [];
  await uploadResumable({
    url: 'u',
    file: soubor(TUS_CHUNK_SIZE * 4),
    fetchImpl: s.doFetch,
    sleep: hnedTed,
    onProgress: (p) => videno.push(p),
  });

  assert.equal(videno[0], 0);
  assert.equal(videno[videno.length - 1], 100);
  for (let i = 1; i < videno.length; i++) {
    assert.ok(videno[i] >= videno[i - 1], 'procenta nesmí couvat: ' + videno.join(','));
  }
});

await test('velikost kusu splňuje podmínky Cloudflare', () => {
  assert.ok(TUS_CHUNK_SIZE >= 5242880, 'nejméně 5 MiB');
  assert.equal(TUS_CHUNK_SIZE % (256 * 1024), 0, 'dělitelné 256 KiB');
  assert.ok(TUS_CHUNK_SIZE <= 209715200, 'nejvýš 200 MiB');
});

await test('práh pro dělení je pod limitem 200 MB', () => {
  assert.ok(RESUMABLE_FROM_BYTES < 200 * 1024 * 1024, 'jinak by se to lámalo dál');
});

await test('base64 pro hlavičku sedí (bez Bufferu i btoa)', () => {
  // Ověřeno proti Node: Buffer.from(x).toString('base64')
  assert.equal(base64Ascii('21600'), 'MjE2MDA=');
  assert.equal(base64Ascii('600'), 'NjAw');
  assert.equal(base64Ascii('1'), 'MQ==');
  assert.equal(base64Ascii('12'), 'MTI=');
  assert.equal(base64Ascii('123'), 'MTIz');
  assert.equal(base64Ascii(''), '');
});

console.log('\n' + prosly + ' kontrol prošlo');
