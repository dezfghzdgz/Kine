/**
 * Kine na plochu (lib/installApp.ts): jaký návod / tlačítko kde, prohlížeče
 * uvnitř appek (Instagram…), iPad s iPadOS, kdy nabídku vůbec neukazovat.
 *
 * Spustit:  node tests/installApp.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/installApp.ts');
const m = await import(join(kam, 'installApp.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.49.87 (iPhone15,2; iOS 18_5; cs_CZ; cs; scale=3.00; 1179x2556; 756321568)',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36 Instagram 389.0.0.49.87 Android',
  androidTikTok: 'Mozilla/5.0 (Linux; Android 13; 2201117TY Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.193 Mobile Safari/537.36 trill_340204 BytedanceWebview/d8a21c6',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/478.0.0.36.111;]',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  linuxDesktop: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};
const sig = (userAgent, extra = {}) => ({ userAgent, platform: '', maxTouchPoints: 0, standalone: false, ...extra });

test('iPhone Safari i Chrome na iPhonu = návod Sdílet → Přidat na plochu', () => {
  assert.equal(m.installPlatform(sig(UA.iphoneSafari, { platform: 'iPhone', maxTouchPoints: 5 })), 'ios');
  assert.equal(m.installPlatform(sig(UA.iphoneChrome, { platform: 'iPhone', maxTouchPoints: 5 })), 'ios');
});

test('iPad s iPadOS (hlásí se jako Mac s dotykem) = ios, Mac bez dotyku ne', () => {
  assert.equal(m.installPlatform(sig(UA.ipadOS, { platform: 'MacIntel', maxTouchPoints: 5 })), 'ios');
  assert.equal(m.installPlatform(sig(UA.ipadOS, { platform: 'MacIntel', maxTouchPoints: 0 })), 'other');
});

test('Instagram, TikTok, Facebook = prohlížeč v appce (i na iPhonu - má přednost před ios)', () => {
  assert.equal(m.installPlatform(sig(UA.iphoneInstagram, { platform: 'iPhone', maxTouchPoints: 5 })), 'in-app');
  assert.equal(m.installPlatform(sig(UA.androidInstagram)), 'in-app');
  assert.equal(m.installPlatform(sig(UA.androidTikTok)), 'in-app');
  assert.equal(m.installPlatform(sig(UA.androidFacebook)), 'in-app');
  assert.equal(m.isInAppBrowser(UA.androidChrome), false);
  assert.equal(m.isInAppBrowser(UA.iphoneSafari), false);
  assert.equal(m.isInAppBrowser(UA.linuxDesktop), false, '„Linux“ není aplikace LINE');
});

test('Android Chrome a Samsung Internet = android', () => {
  assert.equal(m.installPlatform(sig(UA.androidChrome)), 'android');
  assert.equal(m.installPlatform(sig(UA.androidSamsung)), 'android');
});

test('už spuštěné z plochy = installed (nic nenabízet), bez ohledu na prohlížeč', () => {
  assert.equal(m.installPlatform(sig(UA.iphoneSafari, { standalone: true })), 'installed');
  assert.equal(m.installPlatform(sig(UA.androidChrome, { standalone: true })), 'installed');
});

test('nabídka jen na telefonu a tabletu - počítač a televize nikdy', () => {
  assert.equal(m.shouldOfferInstall('ios', 'phone'), true);
  assert.equal(m.shouldOfferInstall('android', 'tablet'), true);
  assert.equal(m.shouldOfferInstall('in-app', 'phone'), true);
  assert.equal(m.shouldOfferInstall('android', 'desktop'), false);
  assert.equal(m.shouldOfferInstall('other', 'phone'), false);
  assert.equal(m.shouldOfferInstall('installed', 'phone'), false);
  assert.equal(m.shouldOfferInstall('ios', 'tv'), false);
  assert.equal(m.installPlatform(sig(UA.windowsChrome)), 'other');
});

test('skript do <head>: chytá beforeinstallprompt a appinstalled, nic nehází', () => {
  const s = m.INSTALL_BOOT_SCRIPT;
  assert.ok(s.includes("addEventListener('beforeinstallprompt'"));
  assert.ok(s.includes('preventDefault()'));
  assert.ok(s.includes("addEventListener('appinstalled'"));
  assert.ok(s.includes(m.INSTALLED_KEY) && s.includes(m.INSTALL_READY_EVENT));
  assert.ok(s.startsWith('(function(){try{') && s.endsWith('}catch(_){}})();'));
  // Spustit nanečisto: falešné window, událost s prompt() - uloží se a značka „nainstalováno“ zmizí.
  const handlers = {};
  const store = { 'kine-app-installed': '1' };
  const fakeWindow = {
    addEventListener: (name, fn) => (handlers[name] = fn),
    dispatchEvent: () => true,
  };
  const fakeStorage = { setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] };
  new Function('window', 'localStorage', 'Event', s)(fakeWindow, fakeStorage, class { constructor(n) { this.type = n; } });
  let prevented = false;
  const ev = { preventDefault: () => (prevented = true), prompt: () => Promise.resolve() };
  handlers.beforeinstallprompt(ev);
  assert.equal(prevented, true);
  assert.equal(fakeWindow.__kineInstallPrompt, ev);
  assert.equal(store['kine-app-installed'], undefined);
  handlers.appinstalled();
  assert.equal(fakeWindow.__kineInstallPrompt, null);
  assert.equal(store['kine-app-installed'], '1');
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
