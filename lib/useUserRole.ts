'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

/**
 * Kdo je přihlášený a co smí.
 *
 * PROČ TO BYLO ROZBITÉ
 *
 * Role se zjišťovala jednou, při prvním vykreslení komponenty, a víc už
 * nikdy. Levé menu se přitom po přihlášení nevykresluje znovu - appka jen
 * přepne adresu. Takže:
 *
 *  - Přihlásíš se jako moderátor: hook si roli zjistil ještě odhlášený,
 *    zůstalo mu "nikdo" a odkaz na Hlášení se neobjevil. Až po ručním
 *    obnovení stránky, protože to komponentu vytvoří znovu.
 *
 *  - Odhlásíš se a přihlásíš na jiný účet: hook si drží roli z minula,
 *    takže neadminovi svítí v menu odkaz na Podíl z výdělků. Data mu
 *    server nevydá (kontroluje si is_admin sám), ale je to matoucí a
 *    vypadá to jako díra.
 *
 * Odteď hook poslouchá změny přihlášení a roli si zjistí znovu.
 */
export function useUserRole() {
  const [role, setRole] = useState<'user' | 'moderator' | 'admin' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Administrátorská práva má appka uložená zvlášť ve sloupci is_admin -
  // podle něj se řídí stránky pod /admin.
  const [isAdmin, setIsAdmin] = useState(false);
  // Dokud se role nezjistí, není pravda ani "je moderátor", ani "není".
  // Bez tohohle stránka mlčky spadne do "nemáš oprávnění" jen proto, že
  // odpověď ještě nedorazila.
  const [loading, setLoading] = useState(true);

  // Číslo posledního dotazu. Když se mezitím někdo přihlásí znovu, starší
  // odpověď se zahodí a nepřepíše tu novější.
  const dotaz = useRef(0);
  // Pro koho máme roli načtenou. Obnovení tokenu (děje se samo, řádově
  // jednou za hodinu) tím pádem nic nepřenačítá a nic neprobliká.
  const nactenoPro = useRef<string | null>(null);

  useEffect(() => {
    async function nacti() {
      const moje = ++dotaz.current;

      const { data: authData } = await supabase.auth.getUser();
      if (moje !== dotaz.current) return;

      if (!authData.user) {
        nactenoPro.current = null;
        setUserId(null);
        setRole(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setUserId(authData.user.id);

      // Sloupce role a is_admin si z prohlížeče přečíst nejde - byly by
      // čitelné i o cizích lidech (viz supabase-migration-privacy-fixes).
      // Funkce my_account vrací schválně jen řádek volajícího.
      const { data } = await supabase.rpc('my_account');
<<<<<<< HEAD
      if (moje !== dotaz.current) return;

      const account = Array.isArray(data) ? data[0] : data;

      nactenoPro.current = authData.user.id;
      setRole((account?.role as 'user' | 'moderator' | 'admin') ?? 'user');
      setIsAdmin(!!account?.is_admin);
      setLoading(false);
    }

    nacti();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const kdo = session?.user?.id ?? null;

      // Stejný člověk jako minule = jen obnovený token. Role se tím nemění,
      // takže se nesmí nic přenačítat.
      if (kdo && kdo === nactenoPro.current) return;

      if (!kdo) {
        // Odhlášení musí práva sebrat okamžitě. Kdyby se čekalo na odpověď
        // serveru, zůstala by v menu na chvíli tlačítka po minulém účtu.
        dotaz.current++;
        nactenoPro.current = null;
        setUserId(null);
        setRole(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      // Supabase nemá rád, když se uvnitř tohohle callbacku rovnou volá
      // dál do něj - umí se to zaseknout. Odloží se to o tik dál.
      setTimeout(nacti, 0);
    });

    return () => {
      dotaz.current++;
      listener.subscription.unsubscribe();
    };
=======
      const account = Array.isArray(data) ? data[0] : data;

      setRole((account?.role as 'user' | 'moderator' | 'admin') ?? 'user');
      setIsAdmin(!!account?.is_admin);
    })();
>>>>>>> 26a30e0f432fb8e78c721e4a6b6a283e6e29220c
  }, []);

  // is_admin schválně NEdělá z člověka moderátora: mazání videí a komentářů
  // se na serveru řídí jen sloupcem role, takže by se mu jinak ukazovala
  // tlačítka, která by mu server stejně odmítl.
  const isModerator = role === 'moderator' || role === 'admin';

  return { role, userId, isModerator, isAdmin, loading };
}
