'use client';

import { useEffect, useState } from 'react';

// Sdílený veřejný testovací klíč Giphy appka používala jako výchozí, ale
// Giphy ho časem zablokovala (běžně se to takovým klíčům stává, jsou
// sdílené mezi hodně appkami najednou). Appka teď radši použije tvůj
// vlastní klíč, pokud ho zadáš do .env.local jako NEXT_PUBLIC_GIPHY_API_KEY -
// zdarma na developers.giphy.com, trvá to pár minut.
const GIPHY_API_KEY = process.env.NEXT_PUBLIC_GIPHY_API_KEY || 'dc6zaTOxFJmzC';
const USING_SHARED_KEY = !process.env.NEXT_PUBLIC_GIPHY_API_KEY;

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

  useEffect(() => {
    search('trending');
  }, []);

  async function search(q: string) {
    setLoading(true);
    setError(null);
    try {
      const endpoint = q === 'trending'
        ? `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`;
      const res = await fetch(endpoint);

      if (!res.ok) {
        if (res.status === 403 && USING_SHARED_KEY) {
          setError('Sdílený testovací klíč Giphy byl zablokovaný. Musíš si založit vlastní zdarma klíč na developers.giphy.com a přidat ho do appky jako NEXT_PUBLIC_GIPHY_API_KEY v souboru .env.local.');
          setGifs([]);
          setLoading(false);
          return;
        }
        const body = await res.text();
        setError(`Giphy vrátilo chybu ${res.status}: ${body.slice(0, 200)}`);
        setGifs([]);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const parsed = (data.data ?? []).map((g: any) => ({
        id: g.id,
        preview: g.images.fixed_width_small?.url ?? g.images.fixed_width?.url,
        full: g.images.original?.url ?? g.images.fixed_width?.url,
      }));
      setGifs(parsed);
      if (parsed.length === 0) {
        setError('Giphy nevrátilo žádné výsledky (odpověď byla v pořádku, ale prázdná).');
      }
    } catch (e: any) {
      setError(`Nepodařilo se spojit s Giphy: ${e?.message ?? 'neznámá chyba'}`);
      setGifs([]);
    }
    setLoading(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    search(query.trim() || 'trending');
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div className="panel" style={{ width: '100%', maxWidth: 480, background: 'var(--panel)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p className="panel-heading" style={{ margin: 0 }}>GIFs</p>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-faint)', padding: 4 }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search GIFs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </form>

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
                <img
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
