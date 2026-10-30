'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';
import { imageUploadExt, imageUploadProblem } from '@/lib/imageUpload';
import UiIcon from './UiIcon';
import ComingSoon from './ComingSoon';
import { CREATOR_PAYMENTS_ENABLED } from '@/lib/payments';
import {
  MAX_POLL_OPTIONS,
  MAX_POST_IMAGES,
  MAX_POST_TEXT,
  POLL_DURATIONS_H,
  cleanPollOptions,
  pollEndsAt,
  videoIdFromLink,
  type PollDuration,
} from '@/lib/posts';

type PostType = 'text' | 'photo' | 'poll';

/**
 * Nový příspěvek na kanálu: text, až 10 fotek, video z Kine (vlastní video
 * nebo odkaz), anketa až o 6 možnostech s koncem (den, 3 dny, týden, bez
 * konce). Odběratelé se zvonečkem dostanou oznámení (/api/posts/notify).
 *
 * "Jen pro členy": příspěvek uvidí jen platící členové kanálu (hlídá to
 * databáze - RLS, migrace supabase-migration-statistiky-prispevky-zamky.sql),
 * ostatní uvidí jen zamčenou dlaždici s počtem. Jde, když běží peníze pro
 * tvůrce a kanál má nastavenou cenu členství; anketa pro členy ne.
 */
export default function PostComposer({
  userId,
  onPosted,
  initialType,
}: {
  userId: string;
  onPosted: () => void;
  initialType?: 'text' | 'photo' | 'poll' | null;
}) {
  const { t } = useLanguage();
  const [type, setType] = useState<PostType>(initialType ?? 'text');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollHours, setPollHours] = useState<PollDuration>(72);
  const [videoPicker, setVideoPicker] = useState(false);
  const [myVideos, setMyVideos] = useState<{ id: string; title: string; thumbnail_url: string | null }[] | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membersOnly, setMembersOnly] = useState(false);
  // Má kanál členství (cena + propojený Stripe)? null = zjišťuje se / placení neběží.
  const [membershipReady, setMembershipReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!CREATOR_PAYMENTS_ENABLED) return;
    let alive = true;
    supabase
      .from('profiles')
      .select('subscription_price_eur, stripe_onboarding_complete')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (!alive) return;
        const p = data as { subscription_price_eur?: number | null; stripe_onboarding_complete?: boolean | null } | null;
        setMembershipReady(!e && !!p?.stripe_onboarding_complete && !!p?.subscription_price_eur);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  async function openVideoPicker() {
    setVideoPicker((v) => !v);
    if (myVideos) return;
    const { data } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url')
      .eq('owner_id', userId)
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(24);
    setMyVideos(data ?? []);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      // Úložiště pustí jen JPEG / PNG / WebP / GIF / AVIF do 10 MB (lib/imageUpload.ts).
      const problem = imageUploadProblem(f, 'post');
      if (problem === 'type') {
        setError(t('imageUploadBadType'));
        continue;
      }
      if (problem === 'size') {
        setError(t('postImageTooBig'));
        continue;
      }
      if (next.length >= MAX_POST_IMAGES) break;
      next.push(f);
    }
    setFiles(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const text = content.trim();
    const options = type === 'poll' ? cleanPollOptions(pollOptions) : null;
    if (type === 'poll' && !options) {
      setError(t('pollNeedsTwo'));
      return;
    }
    const linkedVideo = videoId ?? (videoLink.trim() ? videoIdFromLink(videoLink) : null);
    if (videoLink.trim() && !linkedVideo) {
      setError(t('postVideoLinkInvalid'));
      return;
    }
    if (!text && files.length === 0 && !options && !linkedVideo) return;
    const forMembers = membersOnly && type !== 'poll' && membershipReady === true;
    setPosting(true);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentPostCount } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .gte('created_at', since24h);
    if ((recentPostCount ?? 0) >= 5) {
      setError(t('dailyPostLimitReached'));
      setPosting(false);
      return;
    }

    // Fotky do úložiště - tři naráz (10 fotek za sebou trvalo dlouho), pořadí zůstává.
    // Jedna nepovedená = nic se neodešle, ať se dá zkusit znovu.
    const imageUrls: string[] = [];
    if (type === 'photo' && files.length > 0) {
      const urls: (string | null)[] = new Array(files.length).fill(null);
      let failure: string | null = null;
      let next = 0;
      const worker = async () => {
        while (next < files.length && !failure) {
          const i = next++;
          const file = files[i];
          const ext = imageUploadExt(file) ?? 'jpg';
          // Náhodný název: adresu fotky (třeba z příspěvku pro členy) nejde uhodnout podle času.
          const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 12)}`;
          const path = `${userId}/${random}.${ext}`;
          const { error: uploadError } = await supabase.storage.from('post-images').upload(path, file);
          if (uploadError) {
            failure = uploadError.message;
            return;
          }
          urls[i] = supabase.storage.from('post-images').getPublicUrl(path).data.publicUrl;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
      if (failure || urls.some((u) => !u)) {
        setError(`${t('imageUploadFailed')} ${failure ?? ''}`.trim());
        setPosting(false);
        return;
      }
      imageUrls.push(...(urls as string[]));
    }

    const full = {
      owner_id: userId,
      type,
      content: text || null,
      image_url: imageUrls[0] ?? null,
      image_urls: imageUrls.length > 0 ? imageUrls : null,
      video_id: linkedVideo,
      poll_options: options,
      poll_ends_at: options ? pollEndsAt(pollHours) : null,
      ...(forMembers ? { members_only: true } : {}),
    };
    let { data: inserted, error: insertError } = await supabase.from('posts').insert(full).select('id').single();
    if (forMembers && insertError) {
      // Příspěvek pro členy se nikdy nezveřejní pro všechny (ani náhradní cestou níž).
      setError(/members_only|schema cache|column/i.test(insertError.message ?? '') ? t('postMembersOnlyUnavailable') : `${t('publishFailed')} ${insertError.message ?? ''}`.trim());
      setPosting(false);
      return;
    }
    if (insertError && /image_urls|video_id|poll_ends_at|schema cache|column/i.test(insertError.message ?? '')) {
      // Bez migrace posty-ankety: jedna fotka, odkaz na video do textu, anketa bez konce.
      const withLink = linkedVideo ? `${text}${text ? '\n' : ''}${window.location.origin}/watch/${linkedVideo}` : text;
      ({ data: inserted, error: insertError } = await supabase
        .from('posts')
        .insert({ owner_id: userId, type, content: withLink || null, image_url: imageUrls[0] ?? null, poll_options: options })
        .select('id')
        .single());
    }
    if (insertError || !inserted) {
      setError(`${t('publishFailed')} ${insertError?.message ?? ''}`.trim());
      setPosting(false);
      return;
    }

    // Odběratelé se zvonečkem: oznámení o novém příspěvku (server ohlídá, že jednou).
    const postId = inserted.id;
    void authHeaders().then((headers) =>
      fetch('/api/posts/notify', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ postId }) }).catch(() => {})
    );

    setContent('');
    setFiles([]);
    setPollOptions(['', '']);
    setVideoId(null);
    setVideoLink('');
    setVideoPicker(false);
    setMembersOnly(false);
    setPosting(false);
    onPosted();
  }

  const chosenVideo = videoId ? myVideos?.find((v) => v.id === videoId) ?? null : null;

  return (
    <form onSubmit={handleSubmit} className="panel post-composer">
      <div className="post-composer-types" role="tablist">
        {(
          [
            ['text', 'pencil', 'postTextTab'],
            ['photo', 'image', 'postPhotoTab'],
            ['poll', 'poll', 'postPollTab'],
          ] as const
        ).map(([value, icon, label]) => (
          <button key={value} type="button" role="tab" aria-selected={type === value} className={`post-composer-type${type === value ? ' active' : ''}`} onClick={() => setType(value)}>
            <UiIcon name={icon} size={16} />
            {t(label)}
          </button>
        ))}
      </div>

      <div className="post-composer-text">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={type === 'poll' ? t('postPlaceholderPoll') : t('postPlaceholderText')}
          rows={3}
          maxLength={MAX_POST_TEXT}
        />
        {content.length > MAX_POST_TEXT * 0.8 && (
          <span className="post-composer-count">
            {content.length}/{MAX_POST_TEXT}
          </span>
        )}
      </div>

      {type === 'photo' && (
        <div className="post-composer-photos">
          {previews.map((src, i) => (
            <span key={src} className="post-composer-photo">
              <img src={src} alt="" />
              <button type="button" className="icon-btn" aria-label={t('removeLabel')} onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}>
                <UiIcon name="close" size={14} />
              </button>
            </span>
          ))}
          {files.length < MAX_POST_IMAGES && (
            <label className="post-composer-add-photo">
              <UiIcon name="plus" size={20} />
              <span>{t('postAddPhotos').replace('{n}', String(MAX_POST_IMAGES - files.length))}</span>
              <input
                type="file"
                accept="image/*,.gif"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      )}

      {type === 'poll' && (
        <div className="post-composer-poll">
          {pollOptions.map((opt, i) => (
            <div key={i} className="post-composer-option">
              <input
                type="text"
                placeholder={`${t('pollOptionPlaceholder')} ${i + 1}`}
                value={opt}
                maxLength={120}
                onChange={(e) => {
                  const next = [...pollOptions];
                  next[i] = e.target.value;
                  setPollOptions(next);
                }}
              />
              {pollOptions.length > 2 && (
                <button type="button" className="icon-btn" onClick={() => setPollOptions(pollOptions.filter((_, idx) => idx !== i))} aria-label={t('removePollOption')}>
                  <UiIcon name="close" size={14} />
                </button>
              )}
            </div>
          ))}
          <div className="post-composer-poll-row">
            {pollOptions.length < MAX_POLL_OPTIONS && (
              <button type="button" className="secondary" onClick={() => setPollOptions([...pollOptions, ''])}>
                <UiIcon name="plus" size={14} />
                {t('addPollOption')}
              </button>
            )}
            <label className="post-composer-duration">
              <UiIcon name="timer" size={15} />
              <select value={pollHours} onChange={(e) => setPollHours(Number(e.target.value) as PollDuration)} aria-label={t('pollDuration')}>
                {POLL_DURATIONS_H.map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? t('pollNoEnd') : h === 24 ? t('pollDuration1d') : h === 72 ? t('pollDuration3d') : t('pollDuration7d')}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {type !== 'poll' && (
        <div className="post-composer-video">
          <button type="button" className={`secondary${videoId || videoLink ? ' active' : ''}`} onClick={openVideoPicker} aria-expanded={videoPicker}>
            <UiIcon name="film" size={15} />
            {chosenVideo ? chosenVideo.title : t('postAttachVideo')}
          </button>
          {videoId && (
            <button type="button" className="icon-btn" aria-label={t('removeLabel')} onClick={() => setVideoId(null)}>
              <UiIcon name="close" size={14} />
            </button>
          )}
          {videoPicker && (
            <div className="post-composer-videos">
              {(myVideos ?? []).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`post-composer-video-item${videoId === v.id ? ' active' : ''}`}
                  onClick={() => {
                    setVideoId(v.id);
                    setVideoLink('');
                    setVideoPicker(false);
                  }}
                >
                  {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" loading="lazy" /> : <span />}
                  <span>{v.title}</span>
                </button>
              ))}
              {myVideos && myVideos.length === 0 && <p className="post-composer-hint">{t('postNoOwnVideos')}</p>}
              <input
                type="url"
                placeholder={t('postVideoLinkPlaceholder')}
                value={videoLink}
                onChange={(e) => {
                  setVideoLink(e.target.value);
                  setVideoId(null);
                }}
              />
            </div>
          )}
        </div>
      )}

      {type !== 'poll' && (
        <div className={`post-composer-members${membersOnly && membershipReady ? ' on' : ''}`}>
          <label className="post-composer-members-toggle">
            <input
              type="checkbox"
              checked={membersOnly && membershipReady === true}
              disabled={membershipReady !== true}
              onChange={(e) => setMembersOnly(e.target.checked)}
            />
            <span className="post-composer-members-switch" aria-hidden="true" />
            <UiIcon name="lock" size={15} />
            <span>
              <span className="post-composer-members-title">{t('postMembersOnly')}</span>
              <span className="post-composer-members-hint">{t('postMembersOnlyHint')}</span>
            </span>
          </label>
          {!CREATOR_PAYMENTS_ENABLED ? (
            <ComingSoon pill />
          ) : membershipReady === false ? (
            <Link href="/settings" className="post-composer-members-setup">
              {t('postMembersOnlySetup')}
            </Link>
          ) : null}
        </div>
      )}

      <div className="post-composer-foot">
        <button type="submit" className="post-composer-submit" disabled={posting}>
          <UiIcon name="send" size={15} />
          {posting ? t('publishing') : t('publish')}
        </button>
        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
      </div>
    </form>
  );
}
