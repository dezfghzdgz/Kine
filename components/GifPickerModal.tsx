'use client';

import { useEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';
import { useLanguage } from '@/lib/i18n';

// 0146: GIFy jdou přes náš server (/api/gifs/search, klíč GIPHY_API_KEY jen tam) -
// dřív šel klíč do prohlížeče (NEXT_PUBLIC_…), takže jeho kvótu mohl vyčerpat kdokoli.
import { authHeaders } from '@/lib/authHeaders';

export default function GifPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<{ id: string; preview: string; full: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    search('trending');
  }, []);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      search(query.trim() || 'trending');
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function search(q: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q !== 'trending') params.set('q', q);
      const res = await fetch(`/api/gifs/search?${params}`, { headers: await authHeaders() });
      if (!res.ok) {
        console.warn('Kine: hledání GIFů vrátilo chybu', res.status);
        setError(t('gifLoadFailed'));
        setGifs([]);
        setLoading(false);
        return;
      }
      const data = await res.json();
      const parsed = ((data.gifs ?? []) as { id: string; preview?: { url: string }; full?: { url: string } }[])
        .filter((g) => g.preview?.url && g.full?.url)
        .map((g) => ({ id: g.id, preview: g.preview!.url, full: g.full!.url }));
      setGifs(parsed);
      if (parsed.length === 0) {
        setError(t('gifNoResults'));
      }
    } catch (e: any) {
      console.warn('Kine: GIFy nejde načíst', e?.message);
      setError(t('gifLoadFailed'));
      setGifs([]);
    }
    setLoading(false);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div className="panel modal-glass" style={{ width: '100%', maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p className="panel-heading" style={{ margin: 0 }}>GIFs</p>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" style={{ color: 'var(--text-faint)' }}>
            <UiIcon name="close" size={16} />
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search GIFs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                search(query.trim() || 'trending');
              }
            }}
            autoFocus
          />
        </div>

        <div style={{ maxHeight: 340, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '30px 0' }}>Loading…</p>
          ) : error ? (
            <p className="error-text" style={{ textAlign: 'center', padding: '20px 10px', fontSize: 12.5 }}>{error}</p>
          ) : gifs.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '30px 0' }}>No GIFs found.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {gifs.map((g) => (
                <img loading="lazy" decoding="async"
                  key={g.id}
                  src={g.preview}
                  alt=""
                  onClick={() => onSelect(g.full)}
                  style={{ width: '100%', borderRadius: 6, cursor: 'pointer', aspectRatio: '1/1', objectFit: 'cover' }}
                />
              ))}
            </div>
          )}
        </div>

        <p style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 10, marginBottom: 0, textAlign: 'right' }}>
          Powered by GIPHY
        </p>
      </div>
    </div>
  );
}
