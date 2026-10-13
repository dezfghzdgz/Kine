/**
 * Pravidla komunity, Podmínky používání a Ochrana osobních údajů - texty
 * v češtině a angličtině (components/LegalDoc.tsx ukazuje češtinu tomu,
 * kdo má Kine česky nebo slovensky, ostatním angličtinu; jde přepnout).
 *
 * Psáno srozumitelně, ne právnicky - a podle toho, co Kine opravdu dělá
 * (živé vysílání, podpory, Kine Plus, Kine Clipper, automatická kontrola
 * obsahu, hlášení chyb). Kontakt je jen kinesupport@gmail.com.
 */

export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };
export type LegalDocText = { title: string; intro: string[]; sections: LegalSection[]; footer: string };
export type LegalDoc = { cs: LegalDocText; en: LegalDocText };

export const LEGAL_CONTACT = 'kinesupport@gmail.com';
export const LEGAL_UPDATED = { cs: '12. října 2026', en: '12 October 2026' };

export const RULES: LegalDoc = {
  cs: {
    title: 'Pravidla komunity Kine',
    intro: [
      'Kine stojí na svobodě slova. Chceme, aby tu každý mohl říct, co si myslí - včetně názorů, se kterými nesouhlasíme, kontroverzních témat, ostré satiry a černého humoru. Naprostá většina takového obsahu není útok na konkrétního člověka, ale nadsázka, vtip nebo osobní názor.',
      'Když se ti nějaký názor nelíbí, ohodnoť ho (palcem nebo hvězdičkami) a jdi dál. Mazání a zákazy nejsou nástroj na umlčení názorů, se kterými nesouhlasíš.',
    ],
    sections: [
      {
        heading: 'Co je tady v pořádku (i když to někoho urazí)',
        items: [
          'Kontroverzní politické, náboženské a společenské názory',
          'Satira, parodie a černý humor',
          'Kritika veřejně známých lidí, firem a institucí',
          'Otevřená debata o citlivých tématech',
        ],
      },
      {
        heading: 'Co je zakázané',
        paragraphs: ['Takový obsah smažeme a účtu omezíme nahrávání, vysílání nebo psaní - při opakování natrvalo (jako divák může účet zůstat):'],
        items: [
          'Pornografie a otevřeně sexuální obsah - ve videích, náhledech, vysílání i na profilovkách. Umělecká nahota (malba, socha, film) je v pořádku, pokud není pornografická.',
          'Spam, podvody a klamavý obsah - falešné soutěže, phishing, vydávání se za někoho jiného.',
          'Opakované cílené obtěžování konkrétního člověka.',
          'Umělé nafukování čísel - koupené nebo robotické zhlédnutí, odběry a hodnocení.',
          'Porušování autorských práv (viz níže).',
        ],
      },
      {
        heading: 'Vážná porušení - okamžitý a úplný zákaz účtu',
        paragraphs: ['Za tohle zrušíme celý účet hned (ne jen nahrávání) a v některých případech věc předáme úřadům:'],
        items: [
          'Cokoliv, co zneužívá nebo sexualizuje děti - nulová tolerance, vždy to hlásíme příslušným úřadům.',
          'Skutečné výhrůžky násilím konkrétnímu člověku nebo skupině.',
          'Dokumentování nebo propagace nezákonné činnosti (například prodej drog nebo zbraní, terorismus).',
          'Doxxing - zveřejnění cizích osobních údajů (adresa, telefon) se záměrem uškodit.',
          'Intimní obsah bez souhlasu („revenge porn"), i uměle vytvořený (deepfake).',
        ],
      },
      {
        heading: 'Živé vysílání a chat',
        items: [
          'Pro vysílání platí stejná pravidla jako pro videa. Automatická kontrola obsahu může přenos, ve kterém zachytí nahotu, dočasně skrýt, než ho posoudí moderátor; při opakovaném porušení vysílání skončí.',
          'Ve svém chatu můžeš mazat zprávy, ztlumit nebo zablokovat lidi, zapnout pomalý režim a jmenovat moderátory. Používej to - za atmosféru ve svém vysílání máš kus odpovědnosti i ty.',
          'Podpory jsou dobrovolné dary tvůrci. Nevymáhej je slibem něčeho, co nesplníš, a nepoužívej je k obcházení těchto pravidel.',
        ],
      },
      {
        heading: 'Autorská práva',
        paragraphs: [
          'Nenahrávej nic, k čemu nemáš práva. Pokud si myslíš, že někdo použil tvoje dílo bez svolení, pošli oznámení přes formulář na stránce Autorská práva (/copyright) - účet k tomu nepotřebuješ. Každé oznámení posoudí moderátor; když je oprávněné, video zmizí a ten, kdo ho nahrál, se dozví proč a může se ohradit. Vědomě nepravdivá oznámení jsou porušením pravidel.',
        ],
      },
      {
        heading: 'Vhodnost pro děti',
        paragraphs: ['Při nahrávání uvádíš, jestli je video vhodné pro děti. Ber to vážně - chrání to nejzranitelnější diváky.'],
      },
      {
        heading: 'Jak pravidla vymáháme',
        items: [
          'Obsah posuzujeme podle oznámení od lidí, automatických kontrol (například nahota v náhledech a přenosech) a práce moderátorů.',
          'Podle závažnosti můžeme obsah skrýt nebo smazat, omezit jeho dosah (třeba ho nedoporučovat), omezit funkce účtu (nahrávání, vysílání, chat, výplaty) nebo účet zrušit.',
          `Když si myslíš, že jsme se spletli, napiš na ${LEGAL_CONTACT} - podíváme se na to znovu.`,
        ],
      },
    ],
    footer: `Pravidla budeme časem doplňovat; o podstatných změnách dáme vědět. Používáním Kine s nimi souhlasíš. Poslední změna: ${LEGAL_UPDATED.cs}.`,
  },
  en: {
    title: 'Kine Community Guidelines',
    intro: [
      "Kine is built on free speech. We want everyone to be able to say what they think - including opinions we disagree with, controversial topics, sharp satire and dark humour. The vast majority of that kind of content isn't an attack on a particular person, but exaggeration, a joke or a personal opinion.",
      "If you don't like an opinion, rate it (thumbs or stars) and move on. Removals and bans aren't a tool for silencing opinions you disagree with.",
    ],
    sections: [
      {
        heading: "What's fine here (even if it offends someone)",
        items: [
          'Controversial political, religious and social opinions',
          'Satire, parody and dark humour',
          'Criticism of public figures, companies and institutions',
          'Open discussion of sensitive topics',
        ],
      },
      {
        heading: "What's not allowed",
        paragraphs: ['We remove such content and restrict uploading, streaming or posting for the account - permanently if it repeats (the account can stay on as a viewer):'],
        items: [
          'Pornography and sexually explicit content - in videos, thumbnails, streams and profile pictures. Artistic nudity (painting, sculpture, film) is fine as long as it is not pornographic.',
          'Spam, scams and deceptive content - fake giveaways, phishing, impersonating someone else.',
          'Repeated targeted harassment of a specific person.',
          'Faking numbers - bought or automated views, subscribers and ratings.',
          'Copyright infringement (see below).',
        ],
      },
      {
        heading: 'Serious violations - immediate, full account ban',
        paragraphs: ['For these we close the whole account straight away (not just uploading) and in some cases report it to the authorities:'],
        items: [
          'Anything that abuses or sexualises children - zero tolerance, always reported to the relevant authorities.',
          'Real threats of violence against a specific person or group.',
          'Documenting or promoting illegal activity (for example selling drugs or weapons, terrorism).',
          "Doxxing - publishing someone else's personal details (address, phone number) with intent to harm.",
          'Intimate content shared without consent ("revenge porn"), including artificially generated content (deepfakes).',
        ],
      },
      {
        heading: 'Live streams and chat',
        items: [
          'The same rules apply to streams as to videos. Our automated content check may temporarily hide a stream in which it detects nudity until a moderator reviews it; repeated violations end the stream.',
          "In your chat you can delete messages, mute or ban people, turn on slow mode and appoint moderators. Use them - you share responsibility for the atmosphere in your stream.",
          "Tips are voluntary gifts to the creator. Don't pressure people into tipping by promising things you won't deliver, and don't use tips to get around these rules.",
        ],
      },
      {
        heading: 'Copyright',
        paragraphs: [
          "Don't upload anything you don't have the rights to. If you believe someone used your work without permission, send a notice through the form on the Copyright page (/copyright) - no account needed. A moderator reviews every notice; when it's justified, the video comes down and the uploader is told why and can respond. Knowingly false notices are a violation of these rules.",
        ],
      },
      {
        heading: 'Suitability for children',
        paragraphs: ["When uploading, you say whether a video is suitable for children. Please take this seriously - it protects the most vulnerable viewers."],
      },
      {
        heading: 'How we enforce the rules',
        items: [
          'We review content based on reports from people, automated checks (for example nudity in thumbnails and streams) and the work of moderators.',
          'Depending on how serious it is, we may hide or remove content, limit its reach (for example not recommend it), restrict account features (uploading, streaming, chat, payouts) or close the account.',
          `If you think we got it wrong, write to ${LEGAL_CONTACT} and we will take another look.`,
        ],
      },
    ],
    footer: `We will keep extending these guidelines and will let you know about significant changes. By using Kine you agree to them. Last updated: ${LEGAL_UPDATED.en}.`,
  },
};

export const TERMS: LegalDoc = {
  cs: {
    title: 'Podmínky používání Kine',
    intro: [
      `Kine je služba pro videa, krátká videa (Sparks), živé vysílání a klipy z her - na webu i v aplikacích Kine do PC a Kine Clipper (dohromady „Kine"). Tyhle podmínky říkají, co můžeš čekat ty od nás a my od tebe. Kontakt na nás: ${LEGAL_CONTACT}.`,
    ],
    sections: [
      {
        heading: '1. Kdo může Kine používat',
        items: [
          'Musí ti být aspoň 13 let. Pokud právo tvé země vyžaduje pro používání online služeb bez souhlasu rodičů vyšší věk (v Česku 15 let), potřebuješ do té doby souhlas rodiče nebo zákonného zástupce.',
          'Placené funkce (Kine Plus, předplatné tvůrců, podpory) můžeš používat jen jako dospělý, nebo se souhlasem rodiče.',
          'Účet je osobní: jeden člověk, pravdivé údaje, bezpečné heslo. Za to, co se na tvém účtu děje, odpovídáš ty - když máš podezření na zneužití, napiš nám.',
        ],
      },
      {
        heading: '2. Tvůj obsah',
        items: [
          'Co nahraješ nebo napíšeš (videa, Sparks, vysílání, náhledy, titulky, příspěvky, komentáře, zprávy v chatu), zůstává tvoje.',
          'Nahráním nám dáváš bezplatné, nevýhradní a celosvětové svolení tento obsah ukládat, zpracovávat (převod formátů, náhledy, ukázky po najetí myší, automatické titulky), ukazovat ostatním podle nastavené viditelnosti, doporučovat ho a umožnit ho sdílet odkazem nebo vložit na jiný web. Svolení trvá, dokud obsah nebo účet nesmažeš - kromě kopií v zálohách na omezenou dobu a případů, kdy nám uchování ukládá zákon.',
          'Odpovídáš za to, že k obsahu máš práva (hudba, záběry, cizí díla) a že nezveřejňuješ cizí osobní údaje bez souhlasu.',
        ],
      },
      {
        heading: '3. Pravidla chování',
        paragraphs: ['Co je a není dovolené, popisují Pravidla komunity (/rules). Kromě nich nesmíš:'],
        items: [
          'používat roboty nebo skripty k hromadnému nahrávání, stahování obsahu nebo nafukování čísel,',
          'obcházet zákazy, omezení a limity (třeba novým účtem po zrušení toho starého),',
          'útočit na zabezpečení Kine nebo ho přetěžovat,',
          'posílat vědomě nepravdivá oznámení (například o porušení autorských práv).',
        ],
      },
      {
        heading: '4. Živé vysílání',
        items: [
          'Vysílat můžeš z Kine Clipperu nebo jiného programu (například OBS) přes klíč, který ti Kine dá. Klíč nikomu nedávej.',
          'Ze záznamu vysílání může po skončení vzniknout video na tvém kanálu - podle toho, jak si to nastavíš.',
          'Automatická kontrola obsahu může přenos dočasně skrýt, než ho posoudí moderátor (viz Pravidla komunity).',
        ],
      },
      {
        heading: '5. Automatické systémy',
        paragraphs: [
          'Kine používá automatiku: doporučování videí podle toho, co sleduješ a jak hodnotíš, hodnocení tvůrců (Rating), automatické titulky (umělá inteligence) a automatickou kontrolu nahoty v náhledech a přenosech. Automatika se může splést - když se ti něco nezdá, napiš nám a posoudí to člověk.',
        ],
      },
      {
        heading: '6. Placené funkce',
        items: [
          'Kine Plus a Klipy Plus jsou předplatné placené předem přes Stripe. Cenu (včetně daně) uvidíš před zaplacením. Předplatné se samo obnovuje, dokud ho nezrušíš; zrušit ho můžeš kdykoliv a platí do konce zaplaceného období.',
          'Předplatné tvůrců a podpory ve vysílání jdou přes Stripe přímo tvůrci; Kine si z nich nechává poplatek, který uvidíš předem (běžně 15 %). Podpory jsou dobrovolné dary a nevracejí se, ledaže to vyžaduje zákon nebo jde o podvod.',
          'Tvůrci, kteří dostávají peníze, potřebují vlastní účet u Stripe a sami odpovídají za své daně a odvody.',
          `Pokud jsi spotřebitel, máš všechna práva, která ti dává zákon (včetně odstoupení od smlouvy uzavřené na dálku v rozsahu, který zákon stanoví). Stačí napsat na ${LEGAL_CONTACT}.`,
        ],
      },
      {
        heading: '7. Aplikace Kine do PC a Kine Clipper',
        items: [
          'Aplikace jsou zdarma a samy se aktualizují. Nahrávají obrazovku a zvuk jen na tvém počítači; na Kine nic neposílají, dokud klip nenahraješ ty (nebo automatické nahrávání, pokud si ho s Klipy Plus zapneš).',
          'Za to, co nahraješ a zveřejníš, odpovídáš ty - třeba za hlasy spoluhráčů nebo hudbu ve hře.',
        ],
      },
      {
        heading: '8. Moderace a zrušení účtu',
        items: [
          'Při porušení pravidel můžeme obsah skrýt nebo smazat, omezit jeho dosah, omezit funkce účtu nebo účet zrušit - podle závažnosti, jak popisují Pravidla komunity.',
          'Účet můžeš kdykoliv smazat v Nastavení → Účet. Co se s údaji stane, popisuje Ochrana osobních údajů.',
        ],
      },
      {
        heading: '9. Dostupnost a odpovědnost',
        paragraphs: [
          'Kine poskytujeme tak, jak je - snažíme se, aby fungovalo pořád, ale nemůžeme to zaručit. Za obsah, který nahrávají uživatelé, neodpovídáme; když se o nezákonném obsahu dozvíme, rychle ho odstraníme. V rozsahu, který zákon dovoluje, odpovídáme jen za škodu způsobenou úmyslně nebo z hrubé nedbalosti; to, co zákon omezit nedovoluje (například práva spotřebitelů), tím omezené není.',
        ],
      },
      {
        heading: '10. Změny podmínek',
        paragraphs: [
          'Podmínky můžeme časem upravit. O podstatných změnách dáme vědět předem (v aplikaci nebo e-mailem). Když s nimi nebudeš souhlasit, můžeš účet smazat; dalším používáním Kine změny přijímáš.',
        ],
      },
      {
        heading: '11. Rozhodné právo a spory',
        paragraphs: [
          'Platí české právo; pokud jsi spotřebitel, zůstává ti ochrana, kterou ti dává právo tvé země. Spory řeší české soudy (spotřebitel může žalovat i doma). Spotřebitelé v Česku se mohou obrátit i na mimosoudní řešení sporů u České obchodní inspekce (www.coi.cz).',
        ],
      },
    ],
    footer: `Kontakt: ${LEGAL_CONTACT}. Poslední změna: ${LEGAL_UPDATED.cs}.`,
  },
  en: {
    title: 'Kine Terms of Service',
    intro: [
      `Kine is a service for videos, short videos (Sparks), live streams and game clips - on the web and in the Kine for PC and Kine Clipper apps (together "Kine"). These terms describe what you can expect from us and what we expect from you. Contact: ${LEGAL_CONTACT}.`,
    ],
    sections: [
      {
        heading: '1. Who can use Kine',
        items: [
          "You must be at least 13. If the law of your country requires a higher age for using online services without parental consent (15 in the Czech Republic), you need a parent's or guardian's consent until then.",
          "Paid features (Kine Plus, creator subscriptions, tips) are only for adults or with a parent's consent.",
          "Your account is personal: one person, accurate details, a safe password. You are responsible for what happens on your account - if you suspect misuse, let us know.",
        ],
      },
      {
        heading: '2. Your content',
        items: [
          'What you upload or write (videos, Sparks, streams, thumbnails, captions, posts, comments, chat messages) stays yours.',
          'By uploading it you give us a free, non-exclusive, worldwide permission to store and process it (format conversion, thumbnails, hover previews, automatic captions), show it to others according to the visibility you choose, recommend it and let people share it by link or embed it on other sites. The permission lasts until you delete the content or your account - except for copies kept in backups for a limited time and cases where the law requires us to keep it.',
          "You are responsible for having the rights to your content (music, footage, other people's work) and for not publishing other people's personal details without their consent.",
        ],
      },
      {
        heading: '3. Rules of conduct',
        paragraphs: ["What is and isn't allowed is described in the Community Guidelines (/rules). In addition, you must not:"],
        items: [
          'use bots or scripts to mass-upload, scrape content or inflate numbers,',
          'get around bans, restrictions and limits (for example with a new account after the old one was closed),',
          "attack Kine's security or overload it,",
          'send knowingly false notices (for example about copyright infringement).',
        ],
      },
      {
        heading: '4. Live streaming',
        items: [
          "You can stream from Kine Clipper or another program (for example OBS) with the key Kine gives you. Don't share the key with anyone.",
          'A recording of your stream can become a video on your channel after the stream ends - depending on your settings.',
          'Our automated content check may temporarily hide a stream until a moderator reviews it (see the Community Guidelines).',
        ],
      },
      {
        heading: '5. Automated systems',
        paragraphs: [
          "Kine uses automation: video recommendations based on what you watch and how you rate, creator ratings (Rating), automatic captions (artificial intelligence) and an automated nudity check of thumbnails and streams. Automation can be wrong - if something looks off, write to us and a person will review it.",
        ],
      },
      {
        heading: '6. Paid features',
        items: [
          'Kine Plus and Clips Plus are subscriptions paid in advance through Stripe. You see the price (including tax) before paying. A subscription renews automatically until you cancel it; you can cancel any time and it stays active until the end of the paid period.',
          "Creator subscriptions and tips in streams go through Stripe directly to the creator; Kine keeps a fee shown to you in advance (usually 15%). Tips are voluntary gifts and are not refunded unless the law requires it or in case of fraud.",
          'Creators who receive money need their own Stripe account and are responsible for their own taxes.',
          `If you are a consumer, you keep all the rights the law gives you (including withdrawal from a distance contract to the extent the law provides). Just write to ${LEGAL_CONTACT}.`,
        ],
      },
      {
        heading: '7. Kine for PC and Kine Clipper',
        items: [
          "The apps are free and update themselves. They record your screen and sound only on your computer; nothing is sent to Kine until you upload a clip (or automatic uploading does, if you turn it on with Clips Plus).",
          "You are responsible for what you record and publish - for example your teammates' voices or music in the game.",
        ],
      },
      {
        heading: '8. Moderation and closing accounts',
        items: [
          'If the rules are broken we may hide or remove content, limit its reach, restrict account features or close the account - depending on how serious it is, as described in the Community Guidelines.',
          'You can delete your account any time in Settings → Account. What happens to your data is described in the Privacy Policy.',
        ],
      },
      {
        heading: '9. Availability and liability',
        paragraphs: [
          "We provide Kine as it is - we try hard to keep it running, but we can't guarantee it. We are not responsible for content uploaded by users; when we learn about illegal content, we remove it promptly. To the extent the law allows, we are only liable for damage caused intentionally or by gross negligence; anything the law does not allow to be limited (for example consumer rights) is not limited by this.",
        ],
      },
      {
        heading: '10. Changes to these terms',
        paragraphs: [
          "We may update these terms over time. We will tell you about significant changes in advance (in the app or by email). If you don't agree, you can delete your account; by continuing to use Kine you accept the changes.",
        ],
      },
      {
        heading: '11. Governing law and disputes',
        paragraphs: [
          'Czech law applies; if you are a consumer, you keep the protection given to you by the law of your country. Disputes are handled by Czech courts (consumers can also sue at home). Consumers in the Czech Republic can also use out-of-court dispute resolution at the Czech Trade Inspection Authority (www.coi.cz).',
        ],
      },
    ],
    footer: `Contact: ${LEGAL_CONTACT}. Last updated: ${LEGAL_UPDATED.en}.`,
  },
};

export const PRIVACY: LegalDoc = {
  cs: {
    title: 'Ochrana osobních údajů',
    intro: [
      `Tady najdeš, jaké údaje o tobě Kine má, k čemu je potřebuje, komu je svěřuje a jaká máš práva. Správcem údajů je provozovatel Kine; s čímkoliv se obrať na ${LEGAL_CONTACT}.`,
    ],
    sections: [
      {
        heading: 'Jaké údaje zpracováváme',
        items: [
          'Účet: e-mail, uživatelské a zobrazované jméno, datum registrace, souhlas s pravidly. Heslo vidí jen přihlašovací služba (Supabase) a jen v zašifrované podobě - my ho neznáme.',
          'Profil: profilovka, banner, popis, odkazy, barva kanálu.',
          'Co na Kine děláš: nahraná videa a Sparks (s názvy, popisy, náhledy a titulky), příspěvky, komentáře, hodnocení, odběry, playlisty, historie sledování a místo, kde ses ve videu zastavil, živá vysílání a zprávy v chatu, oznámení.',
          'Platby: probíhají přes Stripe. My vidíme jen co a kdy jsi zaplatil, stav předplatného a označení zákazníka u Stripe - čísla karet nevidíme.',
          'Technické údaje: IP adresa (u zhlédnutí - aby nešlo nafukovat čísla - a kvůli bezpečnosti a omezení zneužití), typ zařízení a prohlížeče, hlášení chyb (co se pokazilo, na jaké stránce, na jakém zařízení) a nastavení uložená v tvém prohlížeči (vzhled, jazyk, hlasitost).',
          'Aplikace Kine do PC a Kine Clipper: klipy a nahrávky zůstávají na tvém počítači. Na Kine jde jen to, co nahraješ (nebo automatické nahrávání, pokud si ho zapneš), a to, co je potřeba ke spojení s účtem. Protokol pro řešení potíží zůstává u tebe - pošleš ho jen ty sám.',
        ],
      },
      {
        heading: 'K čemu údaje používáme a proč smíme',
        items: [
          'Provoz Kine - účet, přehrávání, nahrávání, vysílání, chat, oznámení, předplatné (plnění smlouvy).',
          'Doporučování videí a hodnocení tvůrců (Rating) - aby ti Kine ukazovalo, co tě zajímá (oprávněný zájem). Nedochází přitom k automatickému rozhodování s právními účinky.',
          'Bezpečnost, ochrana před spamem, podvody a zneužitím, moderace a automatická kontrola nahoty (oprávněný zájem a plnění právních povinností).',
          'Platby a účetnictví (plnění smlouvy a právní povinnost).',
          'Hlášení chyb, abychom je mohli opravit (oprávněný zájem).',
          'Tvoje údaje nepoužíváme k reklamě a neprodáváme je.',
        ],
      },
      {
        heading: 'Kdo údaje vidí',
        items: [
          'Ostatní uživatelé vidí to, co je veřejné: jméno, profil, veřejná videa, komentáře, zprávy v chatu, odznaky.',
          'Naši dodavatelé, kteří pro nás údaje zpracovávají: Supabase (databáze, přihlášení, obrázky), Cloudflare (ukládání a přehrávání videí a vysílání, automatické titulky, stahování aplikací), Vercel (provoz webu), Stripe (platby a výplaty tvůrcům), GitHub (stahování a aktualizace aplikací) a Google (e-mail podpory, když nám napíšeš).',
          'Úřady jen tehdy, když to vyžaduje zákon (například hlášení zneužívání dětí).',
        ],
      },
      {
        heading: 'Přenos mimo EU',
        paragraphs: [
          'Někteří dodavatelé sídlí nebo zpracovávají údaje mimo Evropskou unii (hlavně v USA). Přenos je chráněný standardními smluvními doložkami EU nebo rámcem EU-USA pro ochranu osobních údajů.',
        ],
      },
      {
        heading: 'Jak dlouho údaje máme',
        items: [
          'Údaje účtu a tvůj obsah po dobu, kdy máš účet. Po smazání účtu je smažeme; ze záloh zmizí během několika týdnů.',
          'Doklady o platbách tak dlouho, jak ukládají účetní a daňové předpisy.',
          'Hlášení chyb a záznamy zhlédnutí jen po dobu, kterou potřebujeme k jejich účelu.',
        ],
      },
      {
        heading: 'Tvoje práva',
        items: [
          'Přístup a přenositelnost - v Nastavení → Účet si stáhneš kopii svých údajů (JSON).',
          'Výmaz - účet i s údaji smažeš v Nastavení → Účet.',
          'Oprava - profil upravíš kdykoliv v Nastavení.',
          `Omezení zpracování, námitka proti zpracování na základě oprávněného zájmu a odvolání souhlasu - napiš na ${LEGAL_CONTACT}.`,
          'Stížnost u dozorového úřadu - v Česku Úřad pro ochranu osobních údajů (uoou.gov.cz), jinde úřad tvé země.',
        ],
      },
      {
        heading: 'Cookies a paměť prohlížeče',
        paragraphs: [
          'Používáme jen technicky nutné cookies a paměť prohlížeče - kvůli přihlášení a zapamatování nastavení (vzhled, jazyk, hlasitost). Žádné reklamní ani sledovací cookies - proto se tě na ně neptáme.',
        ],
      },
      {
        heading: 'Děti',
        paragraphs: ['Kine není pro děti mladší 13 let. Když zjistíme, že účet patří někomu mladšímu, smažeme ho.'],
      },
      {
        heading: 'Zabezpečení',
        paragraphs: [
          'Spojení je šifrované (HTTPS), hesla se ukládají jen zašifrovaná a k údajům mají přístup jen ti, kdo je nutně potřebují. Žádný systém ale není stoprocentní - kdyby došlo k úniku, který tě ohrožuje, dáme ti vědět.',
        ],
      },
    ],
    footer: `Tenhle dokument budeme upravovat, když se Kine změní; o podstatných změnách dáme vědět. Kontakt: ${LEGAL_CONTACT}. Poslední změna: ${LEGAL_UPDATED.cs}.`,
  },
  en: {
    title: 'Privacy Policy',
    intro: [
      `This page explains what data Kine has about you, what it needs it for, who it shares it with and what rights you have. The data controller is the operator of Kine; for anything, contact ${LEGAL_CONTACT}.`,
    ],
    sections: [
      {
        heading: 'What data we process',
        items: [
          "Account: email, username and display name, sign-up date, agreement to the rules. Your password is only seen by the login service (Supabase) and only in encrypted form - we don't know it.",
          'Profile: profile picture, banner, bio, links, channel colour.',
          'What you do on Kine: uploaded videos and Sparks (with titles, descriptions, thumbnails and captions), posts, comments, ratings, subscriptions, playlists, watch history and where you stopped in a video, live streams and chat messages, notifications.',
          "Payments: handled by Stripe. We only see what you paid and when, your subscription status and your Stripe customer reference - we don't see card numbers.",
          'Technical data: IP address (for views - so numbers can\'t be inflated - and for security and abuse prevention), device and browser type, error reports (what went wrong, on which page, on what device) and settings stored in your browser (appearance, language, volume).',
          "Kine for PC and Kine Clipper: clips and recordings stay on your computer. Only what you upload (or automatic uploading, if you turn it on) and what is needed to connect the app to your account goes to Kine. The troubleshooting log stays with you - only you can send it.",
        ],
      },
      {
        heading: 'What we use data for and why we may',
        items: [
          'Running Kine - account, playback, uploading, streaming, chat, notifications, subscriptions (performance of a contract).',
          'Recommending videos and rating creators (Rating) - so Kine shows you what interests you (legitimate interest). This involves no automated decisions with legal effects.',
          'Security, protection against spam, fraud and abuse, moderation and the automated nudity check (legitimate interest and legal obligations).',
          'Payments and accounting (performance of a contract and legal obligation).',
          'Error reports, so we can fix problems (legitimate interest).',
          "We don't use your data for advertising and we don't sell it.",
        ],
      },
      {
        heading: 'Who sees the data',
        items: [
          'Other users see what is public: your name, profile, public videos, comments, chat messages, badges.',
          'Our providers who process data for us: Supabase (database, login, images), Cloudflare (storing and playing videos and streams, automatic captions, app downloads), Vercel (running the website), Stripe (payments and creator payouts), GitHub (app downloads and updates) and Google (support email, when you write to us).',
          'Authorities only when the law requires it (for example reporting child abuse).',
        ],
      },
      {
        heading: 'Transfers outside the EU',
        paragraphs: [
          'Some providers are based in or process data outside the European Union (mainly in the USA). Such transfers are protected by EU Standard Contractual Clauses or the EU-US Data Privacy Framework.',
        ],
      },
      {
        heading: 'How long we keep data',
        items: [
          'Account data and your content for as long as you have an account. When you delete your account we delete them; they disappear from backups within a few weeks.',
          'Payment records for as long as accounting and tax laws require.',
          'Error reports and view logs only for as long as we need them for their purpose.',
        ],
      },
      {
        heading: 'Your rights',
        items: [
          'Access and portability - download a copy of your data (JSON) in Settings → Account.',
          'Erasure - delete your account together with its data in Settings → Account.',
          'Rectification - edit your profile any time in Settings.',
          `Restriction of processing, objection to processing based on legitimate interest and withdrawal of consent - write to ${LEGAL_CONTACT}.`,
          'Complaint to a supervisory authority - in the Czech Republic the Office for Personal Data Protection (uoou.gov.cz), elsewhere the authority in your country.',
        ],
      },
      {
        heading: 'Cookies and browser storage',
        paragraphs: [
          "We only use technically necessary cookies and browser storage - to keep you logged in and remember your settings (appearance, language, volume). No advertising or tracking cookies - which is why we don't ask you about them.",
        ],
      },
      {
        heading: 'Children',
        paragraphs: ["Kine is not for children under 13. If we find out that an account belongs to someone younger, we delete it."],
      },
      {
        heading: 'Security',
        paragraphs: [
          "Connections are encrypted (HTTPS), passwords are only stored encrypted and only people who really need it have access to data. No system is perfect, though - if a breach ever puts you at risk, we will tell you.",
        ],
      },
    ],
    footer: `We will update this document when Kine changes and will let you know about significant changes. Contact: ${LEGAL_CONTACT}. Last updated: ${LEGAL_UPDATED.en}.`,
  },
};
