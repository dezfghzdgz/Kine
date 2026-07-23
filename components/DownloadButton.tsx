'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function DownloadButton({ videoId, cloudflareVideoId }: { videoId: string; cloudflareVideoId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);

    try {
      let url: string | null = null;
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setError('Musíš být přihlášený, abys mohl/a video stáhnout.');
        setLoading(false);
        return;
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        const res = await fetch('/api/videos/enable-download', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
          body: JSON.stringify({ cloudflareVideoId }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Stažení se nepovedlo povolit.');
        }

        if (data.status === 'ready' && data.url) {
          url = data.url;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 2500));
      }

      if (!url) {
        throw new Error('Soubor ke stažení se nestihl připravit, zkus to za chvíli znovu.');
      }

      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        await supabase.from('downloads').upsert({
          user_id: authData.user.id,
          video_id: videoId,
          downloaded_at: new Date().toISOString(),
        });
      }

      window.open(url, '_blank');
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div>
      <button className="reaction-btn" onClick={handleDownload} disabled={loading}>
        {loading ? 'Připravuji…' : '⬇ Stáhnout'}
      </button>
      {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  );
}
