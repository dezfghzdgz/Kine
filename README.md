# StreamHub – základ video platformy

Toto je funkční základ (MVP) video platformy: registrace, přihlášení, upload videa,
přehrávání, lajky/disliky a komentáře. Postaveno na Next.js + Supabase + Cloudflare Stream.

## Co budeš potřebovat (vše zdarma na start)

1. **Node.js 20+** – https://nodejs.org
2. **Supabase účet** – https://supabase.com → New Project
3. **Cloudflare účet se Stream** – https://dash.cloudflare.com → Stream (vyžaduje kartu, ale
   platíš jen za skutečně nahraná/streamovaná videa, na testování to bude pár centů)

## Krok 1 – Nastavení Supabase

1. Založ nový projekt na supabase.com
2. Jdi do **SQL Editor** → New query → vlož celý obsah souboru `supabase-schema.sql` z tohoto
   projektu → Run
3. Jdi do **Project Settings → API** a zkopíruj:
   - `Project URL`
   - `anon public` klíč
   - `service_role` klíč (Settings → API → service_role – drž ho v tajnosti!)

## Krok 2 – Nastavení Cloudflare Stream

1. V Cloudflare dashboardu aktivuj **Stream**
2. Zkopíruj svoje **Account ID** (najdeš vpravo na dashboardu)
3. Jdi do **My Profile → API Tokens → Create Token** → vytvoř token s oprávněním
   "Stream: Edit"

## Krok 3 – Lokální spuštění

```bash
# Rozbal projekt a přejdi do složky
cd video-platform-starter

# Nainstaluj závislosti
npm install

# Zkopíruj .env.example do .env.local a vyplň svoje klíče
cp .env.example .env.local
```

Otevři `.env.local` a vyplň všechny hodnoty, které jsi zkopíroval v krocích 1 a 2.

```bash
# Spusť vývojový server
npm run dev
```

Otevři http://localhost:3000 – appka by měla běžet.

## Krok 4 – Vyzkoušej to

1. Jdi na `/signup` a založ si účet
2. Jdi na `/upload` a nahraj testovací video (klidně krátké, pár sekund)
3. Cloudflare video zpracuje na pozadí (u krátkých videí to zabere pár desítek sekund) –
   pak se objeví na hlavní stránce

## Nasazení na web (aby to bylo veřejně dostupné)

1. Nahraj tenhle kód na GitHub (soukromý repozitář stačí)
2. Jdi na https://vercel.com → New Project → vyber svůj repozitář
3. Do Vercel **Environment Variables** vlož stejné hodnoty jako máš v `.env.local`
4. Deploy – Vercel ti dá veřejnou URL adresu (např. `streamhub.vercel.app`)

## Co ve verzi zatím chybí (a přijde příště)

- Live streaming
- Shorts formát
- Systém výplat tvůrcům
- Mobilní aplikace
- Sledování kanálů / odběratelé
- Doporučovací systém videí

Tohle je záměrně jen **kostra na ověření základní myšlenky** – registrace, upload, přehrávání,
reakce. Než budeš přidávat další featury, over si na pár lidech, jestli tahle základní smyčka
vůbec funguje a dává smysl.

## Struktura projektu

```
app/
  page.tsx              - hlavní stránka (seznam videí)
  login/page.tsx         - přihlášení
  signup/page.tsx         - registrace
  upload/page.tsx         - nahrávání videa
  watch/[id]/page.tsx     - přehrávání videa
  api/videos/            - backend endpointy pro upload
components/
  VideoReactions.tsx      - lajk/dislike tlačítka
  CommentSection.tsx      - komentáře
lib/
  supabaseClient.ts       - Supabase klient pro prohlížeč
  supabaseServer.ts       - Supabase klient pro server (víc oprávnění)
supabase-schema.sql       - databázové schéma, spustit v Supabase SQL editoru
```
