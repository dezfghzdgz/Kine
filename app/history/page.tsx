'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows, fetchByIds } from '@/lib/loadAll';
import { useLanguage } from '@/lib/i18n';
import LoadFailed from '@/components/LoadFailed';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast, { ToastType } from '@/components/Toast';

/**
 * Historie sledování. Položku jde odebrat (✕ na kartě) a celou historii
 * smazat - jako na YouTube. Odebrané video zmizí i z "Pokračovat ve
 * sledování" a doporučování ho přestane brát jako zhlédnuté.
 */
function HistoryPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Dotaz může spadnout (vypadlá síť, propadlé přihlášení). Bez tohohle
  // stránka tvrdila, že seznam je prázdný.
  const [loadFailed, setLoadFailed] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    startLoad();
  }, []);

  /**
   * Načtení seznamu tak, aby se dalo poznat, že se nepovedlo.
   *
   * fetchAllRows/fetchByIds odteď chybu vyhodí místo toho, aby vrátily
   * prázdno - jinak se výpadek sítě tvářil úplně stejně jako prázdný
   * seznam a stránka napsala "zatím tu nic není" i tomu, kdo tu má sto
   * položek.
   */
  async function startLoad() {
    setLoading(true);
    setLoadFailed(false);
    try {
      await load();
    } catch {
      setLoadFailed(true);
      setLoading(false);
    }
  }

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLoading(false);
      return;
    }
    setUserId(authData.user.id);

    // Po dávkách: bez toho vrátí databáze nejvýš tisíc řádků a zbytek
    // historie tiše zmizí. fetchByIds navíc rozdělí dotaz na videa, aby
    // adresa nepřerostla - u pár stovek položek se dotaz jinak neprovede
    // vůbec a stránka zůstane prázdná bez chybové hlášky.
    const history = await fetchAllRows((from, to) =>
      supabase
        .from('watch_history')
        .select('video_id, watched_at')
        .eq('user_id', authData.user!.id)
        .order('watched_at', { ascending: false })
        .range(from, to)
    );

    const videoIds = history.map((h: any) => h.video_id);
    if (videoIds.length > 0) {
      // Pořadí drží historie, ne databáze - proto ho fetchByIds zachovává.
      setVideos(await fetchByIds<any>('videos', 'id, title, thumbnail_url, views, profiles!videos_owner_id_fkey(username)', videoIds));
    } else {
      setVideos([]);
    }

    setLoading(false);
  }

  async function removeOne(videoId: string) {
    if (!userId) return;
    const before = videos;
    setVideos((list) => list.filter((v) => v.id !== videoId));
    const { error } = await supabase.from('watch_history').delete().eq('user_id', userId).eq('video_id', videoId);
    if (error) {
      setVideos(before);
      setToast({ message: t('menuActionFailed'), type: 'error' });
    }
  }

  async function clearAll() {
    setConfirmClear(false);
    if (!userId) return;
    const { error } = await supabase.from('watch_history').delete().eq('user_id', userId);
    if (error) {
      setToast({ message: t('menuActionFailed'), type: 'error' });
      return;
    }
    setVideos([]);
    setToast({ message: t('historyClearedNote'), type: 'success' });
  }

  if (loadFailed) return <LoadFailed onRetry={startLoad} />;
  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>{t('historySignInNote')}</p>
        <Link href="/login?next=%2Fhistory">{t('loginLink')}</Link>
      </div>
    );
  }

  const filtered = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;

  if (videos.length === 0) {
    return (
      <div className="auth-gate">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <p>{t('historyTitle')}</p>
        <p style={{ fontSize: 13 }}>{t('historyEmptyNote')}</p>
      </div>
    );
  }

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmClear && <ConfirmDialog message={t('historyClearConfirm')} onConfirm={clearAll} onCancel={() => setConfirmClear(false)} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <p className="section-title" style={{ margin: 0 }}>{t('historyTitle')}</p>
        <button type="button" className="reaction-btn" onClick={() => setConfirmClear(true)}>
          {t('historyClearButton')}
        </button>
      </div>
      <div className="video-grid">
        {filtered.map((v: any) => (
          <div key={v.id} className="video-card history-card">
            <Link href={`/watch/${v.id}`}>
              <div className="video-thumb">
                {v.thumbnail_url ? <Image src={v.thumbnail_url} alt={v.title} width={320} height={180} /> : null}
                <div className="play-badge">▶</div>
              </div>
              <p className="video-card-title">{v.title}</p>
              <p className="video-card-meta">
                {v.profiles?.username ?? t('unknownCreator')} · {v.views} {t('views')}
              </p>
            </Link>
            <button
              type="button"
              className="history-remove"
              onClick={() => removeOne(v.id)}
              aria-label={t('historyRemoveItem')}
              title={t('historyRemoveItem')}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={null}>
      <HistoryPageInner />
    </Suspense>
  );
}
