'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { EMOTE_MAX_BYTES, EMOTE_SIZE, MAX_CHANNEL_EMOTES, validChannelEmoteCode, type ChatEmote } from '@/lib/chatEmotes';

/** Obrázek pro nahrání: statický se zmenší na 112 px (PNG), GIF / WebP zůstanou (můžou být animované). */
async function prepareImage(file: File): Promise<{ image: Blob; scan: Blob }> {
  const bitmap = await createImageBitmap(file);
  try {
    const keep = (file.type === 'image/gif' || file.type === 'image/webp') && file.size <= EMOTE_MAX_BYTES;
    let image: Blob = file;
    if (!keep) {
      const canvas = document.createElement('canvas');
      canvas.width = EMOTE_SIZE;
      canvas.height = EMOTE_SIZE;
      const ctx = canvas.getContext('2d')!;
      const scale = Math.min(EMOTE_SIZE / bitmap.width, EMOTE_SIZE / bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, Math.round((EMOTE_SIZE - w) / 2), Math.round((EMOTE_SIZE - h) / 2), w, h);
      image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
    }
    // Náhled pro kontrolu obsahu: první snímek na šedém pozadí jako JPEG.
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = 224;
    scanCanvas.height = 224;
    const sctx = scanCanvas.getContext('2d')!;
    sctx.fillStyle = '#808080';
    sctx.fillRect(0, 0, 224, 224);
    const s = Math.min(224 / bitmap.width, 224 / bitmap.height);
    sctx.drawImage(bitmap, (224 - bitmap.width * s) / 2, (224 - bitmap.height * s) / 2, bitmap.width * s, bitmap.height * s);
    const scan = await new Promise<Blob>((resolve, reject) => scanCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', 0.85));
    return { image, scan };
  } finally {
    bitmap.close();
  }
}

/**
 * Emoty kanálu v nastavení chatu (jen majitel kanálu a tým Kine): seznam,
 * smazání a nahrání nového - obrázek a kód, kterým ho diváci píšou.
 */
export default function ChatEmoteManager({
  room,
  emotes,
  available,
  onChange,
}: {
  room: string;
  emotes: ChatEmote[];
  available: boolean;
  onChange: (emotes: ChatEmote[]) => void;
}) {
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  // Náhled vybraného obrázku (než se nahraje).
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function token(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = code.trim();
    if (!validChannelEmoteCode(clean)) {
      setError(t('liveChatEmoteErrCode'));
      return;
    }
    if (!file || !/^image\/(png|gif|webp|jpeg)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
      setError(t('liveChatEmoteErrFile'));
      return;
    }
    setBusy(true);
    try {
      const { image, scan } = await prepareImage(file);
      if (image.size > EMOTE_MAX_BYTES) {
        setError(t('liveChatEmoteErrFile'));
        return;
      }
      const form = new FormData();
      form.append('room', room);
      form.append('code', clean);
      form.append('image', image, 'emote');
      form.append('scan', scan, 'scan.jpg');
      const res = await fetch('/api/live/chat/emotes', { method: 'POST', headers: await token(), body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.emote) {
        setError(body?.error ?? t('liveChatUnavailable'));
        return;
      }
      onChange([...emotes, body.emote as ChatEmote]);
      setCode('');
      setFile(null);
      setInputKey((k) => k + 1);
    } catch {
      setError(t('liveChatEmoteErrFile'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setConfirmId(null);
    setError(null);
    const res = await fetch(`/api/live/chat/emotes?room=${encodeURIComponent(room)}&id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: await token() }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setError(body?.error ?? t('liveChatUnavailable'));
      return;
    }
    onChange(emotes.filter((e) => e.id !== id));
  }

  return (
    <div className="chat-emote-manager">
      <p className="live-chat-panel-title">
        {t('liveChatChannelEmotes')}{' '}
        <span className="live-chat-panel-note">{t('liveChatEmoteCount').replace('{n}', String(emotes.length)).replace('{max}', String(MAX_CHANNEL_EMOTES))}</span>
      </p>
      {!available && <p className="live-chat-panel-note">{t('liveChatExtrasNeedMigration')}</p>}
      <p className="live-chat-panel-note">{t('liveChatChannelEmotesHint')}</p>
      {emotes.length > 0 && (
        <div className="chat-emote-list">
          {emotes.map((e) => (
            <span key={e.id ?? e.code} className="chat-emote-chip">
              <img src={e.url} alt="" />
              <code>{e.code}</code>
              {e.id &&
                (confirmId === e.id ? (
                  <button type="button" className="danger" onClick={() => remove(e.id!)}>
                    {t('liveChatEmoteDelete')}
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmId(e.id!)} aria-label={t('liveChatEmoteDelete')} title={t('liveChatEmoteDelete')}>
                    ✕
                  </button>
                ))}
            </span>
          ))}
        </div>
      )}
      {available && emotes.length < MAX_CHANNEL_EMOTES && (
        <form className="chat-emote-add" onSubmit={add}>
          <label className="live-small-btn chat-emote-file">
            {preview ? <img src={preview} alt="" /> : null}
            <span>{file ? file.name : t('liveChatEmoteFile')}</span>
            <input
              key={inputKey}
              type="file"
              accept="image/png,image/gif,image/webp,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-label={t('liveChatEmoteFile')}
            />
          </label>
          <input type="text" value={code} maxLength={24} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} placeholder={t('liveChatEmoteCode')} aria-label={t('liveChatEmoteCode')} />
          <button type="submit" className="live-small-btn" disabled={busy || !file || !code.trim()}>
            {busy ? t('liveChatEmoteAdding') : t('liveChatEmoteAdd')}
          </button>
        </form>
      )}
      {error && <p className="live-chat-panel-note error">{error}</p>}
    </div>
  );
}
