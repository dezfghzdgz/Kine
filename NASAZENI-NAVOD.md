# Jak appku pustit "naostro" (aby se mohl přihlásit kdokoliv)

Appka běží v mém sandboxu bez přístupu na internet, takže samotné kliknutí na
"Deploy" musíš udělat ty - ale appka je na to připravená a tenhle soubor tě
provede krok za krokem.

## 1. Appka na GitHub (jednou, pak se to updatuje samo)

1. Založ si účet na github.com (zdarma), pokud ho ještě nemáš
2. Vytvoř nový repozitář (např. "kine")
3. Nahraj do něj celou složku appky (buď přes web rozhraní GitHubu - "Upload files",
   nebo přes GitHub Desktop appku, což je jednodušší na víc souborů najednou)

## 2. Appka na Vercel (appka, co appku "spustí" pro celý internet)

1. Jdi na vercel.com, založ si účet zdarma (nejjednodušší je přihlásit se rovnou
   přes GitHub účet z kroku 1)
2. Klikni "Add New Project" a vyber repozitář "kine"
3. Vercel appku pozná (je to Next.js appka, pozná to samo) - **NEKLIKEJ ještě Deploy**
4. Rozklikni "Environment Variables" a vlož TAM PŘESNĚ TY SAMÉ hodnoty, co máš
   teď v souboru `.env.local` na svém počítači:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
   - CLOUDFLARE_ACCOUNT_ID
   - CLOUDFLARE_STREAM_API_TOKEN
   - NEXT_PUBLIC_GIPHY_API_KEY (pokud už máš vlastní klíč)
5. Teprve teď klikni "Deploy"
6. Za pár minut appka dostane veřejnou adresu, něco jako `kine-xyz.vercel.app`

## 3. Důležitý krok v Supabase (jinak se nepůjde přihlásit/registrovat!)

Appka teď zná appku jen jako `localhost:3000`. Musíš appce říct její novou,
skutečnou adresu:

1. Supabase dashboard → **Authentication → URL Configuration**
2. **Site URL**: změň na svoji novou Vercel adresu (`https://kine-xyz.vercel.app`)
3. **Redirect URLs**: přidej `https://kine-xyz.vercel.app/reset-password`
   (nech tam klidně i tu s localhost, ať appka jde testovat dál i u tebe doma)

## 4. Vlastní doména (nepovinné, ale hezčí než "kine-xyz.vercel.app")

1. Kup si doménu (Namecheap, Forpsi, Wedos...) - řádově pár stovek Kč/rok
2. Ve Vercelu: Project → Settings → Domains → přidej svou doménu
3. Vercel ti řekne přesně, jaký záznam si máš nastavit u toho, kde jsi doménu koupil
4. Zopakuj krok 3 (Supabase Site URL/Redirect URLs) s novou doménou místo Vercel adresy

## 5. Otestuj to pořádně, než to ukážeš lidem

- Zaregistruj se jako nový uživatel na skutečné veřejné adrese
- Nahraj video, projdi appku napříč (appka jsme spolu ladili hodně dlouho, ale
  "naostro" prostředí je pořád trochu jiné než tvůj počítač)

## 6. Aby appku šlo najít v Googlu (ne jen přes odkaz)

Appka teď umí appce automaticky vytvořit `/robots.txt` a `/sitemap.xml` (seznam
všech stránek appky pro vyhledávače) - stačí appce dát vědět svou skutečnou
adresu:

1. Do Environment Variables ve Vercelu (viz krok 2) přidej ještě
   `NEXT_PUBLIC_SITE_URL` s hodnotou tvé skutečné adresy (`https://kine.cz`
   nebo `https://kine-xyz.vercel.app`)
2. Jdi na **Google Search Console** (search.google.com/search-console),
   zdarma se přihlas přes Google účet
3. Přidej appku svou adresu jako "Property"
4. Google appce dá adresu na ověření vlastnictví appky (obvykle přes DNS
   záznam nebo HTML soubor - Search Console tě tím provede)
5. Po ověření appce v Search Console dej appce vědět o sitemapě: vlož adresu
   `https://tvoje-adresa.cz/sitemap.xml` do sekce "Sitemaps"

**Buď prosím trpělivý/á:** appka se v Googlu neobjeví hned - obvykle to
appce trvá pár dní až týdny, než appka appku poprvé zaindexuje, a mnohem
déle, než appka appku začne appce ukazovat na předních místech výsledků
(to už záleží hlavně na tom, kolik lidí appku skutečně používá a odkazuje
na ni odjinud, ne na technickém nastavení).
