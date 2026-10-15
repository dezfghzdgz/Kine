'use client';

import { memo, useMemo } from 'react';
import { useLanguage } from '@/lib/i18n';
import { chatNameColor, followTier, isEmoteOnlyMessage, tokenizeChat, type ChatBadge, type ChatEmote, type ChatMeta } from '@/lib/chatEmotes';
import UiIcon, { type UiIconName } from './UiIcon';

/**
 * Text zprávy v chatu: emoty jako obrázky (kód zůstane v alt - zkopíruje se
 * jako text), @zmínky zvýrazněné (o mně výrazněji), odkazy klikací. Zpráva
 * jen z emotů / emoji je větší (jako na Discordu).
 */
export const ChatBody = memo(function ChatBody({
  body,
  emotes,
  me,
  jumbo = true,
}: {
  body: string;
  emotes: ReadonlyMap<string, ChatEmote>;
  /** Moje jméno - zmínka o mně se zvýrazní víc. */
  me?: string | null;
  /** Zprávu jen z emotů zvětšit. */
  jumbo?: boolean;
}) {
  const tokens = useMemo(() => tokenizeChat(body, emotes, me), [body, emotes, me]);
  const big = jumbo && tokens.length <= 12 && isEmoteOnlyMessage(body, emotes);
  return (
    <span className={`chat-body${big ? ' chat-jumbo' : ''}`}>
      {tokens.map((tok, i) => {
        if (tok.kind === 'emote') {
          return <img key={i} className="chat-emote" src={tok.url} alt={tok.code} title={tok.code} loading="lazy" decoding="async" draggable={false} />;
        }
        if (tok.kind === 'mention') {
          return (
            <span key={i} className={`chat-mention${tok.self ? ' self' : ''}`}>
              @{tok.name}
            </span>
          );
        }
        if (tok.kind === 'link') {
          return (
            <a key={i} className="chat-link" href={tok.href} target="_blank" rel="noopener noreferrer nofollow ugc">
              {tok.text}
            </a>
          );
        }
        return <span key={i}>{tok.text}</span>;
      })}
    </span>
  );
});

const BADGE_ICON: Record<ChatBadge, UiIconName> = {
  broadcaster: 'broadcast',
  staff: 'sparkle',
  moderator: 'shield',
  verified: 'check',
  follower: 'heart',
};

/** Odznaky před jménem (vysílající, tým Kine, moderátor, ověřený, odběratel podle délky odběru). */
export function ChatBadges({ meta }: { meta: ChatMeta }) {
  const { t } = useLanguage();
  if (!meta.b?.length) return null;
  const label = (b: ChatBadge): string => {
    switch (b) {
      case 'broadcaster':
        return t('liveChatBadgeBroadcaster');
      case 'staff':
        return t('liveChatBadgeStaff');
      case 'moderator':
        return t('liveChatBadgeModerator');
      case 'verified':
        return t('liveChatBadgeVerified');
      default:
        return meta.fm && meta.fm >= 1 ? t('liveChatBadgeFollowerMonths').replace('{n}', String(meta.fm)) : t('liveChatBadgeFollower');
    }
  };
  const order: ChatBadge[] = ['broadcaster', 'staff', 'moderator', 'verified', 'follower'];
  return (
    <span className="chat-badges">
      {order
        .filter((b) => meta.b!.includes(b))
        .map((b) => (
          <span key={b} className={`chat-badge chat-badge-${b}${b === 'follower' ? ` tier-${followTier(meta.fm)}` : ''}`} title={label(b)} aria-label={label(b)} role="img">
            <UiIcon name={BADGE_ICON[b]} size={11} />
          </span>
        ))}
    </span>
  );
}

/** Jméno v barvě (zvolené, nebo podle účtu) s odznaky. */
export function ChatName({ userId, name, meta, onClick }: { userId: string; name: string; meta: ChatMeta; onClick?: () => void }) {
  const color = meta.c ?? chatNameColor(userId);
  return (
    <>
      <ChatBadges meta={meta} />
      {onClick ? (
        <button type="button" className="live-chat-user chat-name" style={{ color }} onClick={onClick}>
          {name}
        </button>
      ) : (
        <span className="live-chat-user chat-name" style={{ color }}>
          {name}
        </span>
      )}
    </>
  );
}
