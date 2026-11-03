'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { EMOTE_MAX_BYTES, EMOTE_SIZE, MAX_CHANNEL_EMOTES, validChannelEmoteCode, type ChatEmote } from '@/lib/chatEmotes';
import UiIcon from './UiIcon';

/**
 * Je GIF / WebP animovaný? GIF: víc než jeden blok "řízení snímku" (0x21 0xF9),
 * WebP: kontejner VP8X s příznakem animace. Na hrubé rozlišení stačí - jde jen
 * o to, jestli obrázek poslat beze změny (animovaný), nebo ho převést na PNG.
 */
async function isAnimated(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/gif') {
    let frames = 0;
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++frames > 1) return true;
    }
    return false;
  }
  if (file.type === 'image/webp') {
    const fourcc = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    return bytes.length > 21 && fourcc(12) === 'VP8X' && (bytes[20] & 0x02) !== 0;
  }
  return false;
}

/**
 * Obrázek pro nahrání: statický se zmenší na 112 px PNG (server ho sám
 * zkontroluje a emote je hned v chatu), animovaný GIF / WebP zůstane, jak je
 * (čeká na schválení moderátorem - server animaci zkontrolovat neumí).
 */
async function prepareImage(file: File): Promise<Blob> {
  if ((file.type === 'image/gif' || file.type === 'image/webp') && file.size <= EMOTE_MAX_BYTES && (await isAnimated(file))) return file;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = EMOTE_SIZE;
    canvas.height = EMOTE_SIZE;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.min(EMOTE_SIZE / bitmap.width, EMOTE_SIZE / bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, Math.round((EMOTE_SIZE - w) / 2), Math.round((EMOTE_SIZE - h) / 2), w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
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
  const [note, setNote] = useState<string | null>(null);
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
    setNote(null);
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
      const image = await prepareImage(file);
      if (image.size > EMOTE_MAX_BYTES) {
        setError(t('liveChatEmoteErrFile'));
        return;
      }
      const form = new FormData();
      form.append('room', room);
      form.append('code', clean);
      form.append('image', image, 'emote');
      const res = await fetch('/api/live/chat/emotes', { method: 'POST', headers: await token(), body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.emote) {
        setError(body?.code === 'unverifiable' ? t('liveChatEmoteErrUnverifiable') : body?.error ?? t('liveChatUnavailable'));
        return;
      }
      onChange([...emotes, body.emote as ChatEmote]);
      // Animovaný emote čeká na moderátora - ať majitel ví, proč ho v chatu zatím nevidí.
      if (body.pending || body.emote?.pending) setNote(t('liveChatEmotePending'));
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
            <span key={e.id ?? e.code} className={`chat-emote-chip${e.pending ? ' pending' : ''}`} title={e.pending ? t('liveChatEmotePending') : undefined}>
              <img src={e.url} alt="" />
              <code>{e.code}</code>
              {e.pending && (
                <span className="chat-emote-pending" aria-label={t('liveChatEmotePending')}>
                  <UiIcon name="timer" size={13} />
                </span>
              )}
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
      {note && !error && <p className="live-chat-panel-note">{note}</p>}
      {error && <p className="live-chat-panel-note error">{error}</p>}
    </div>
  );
}
