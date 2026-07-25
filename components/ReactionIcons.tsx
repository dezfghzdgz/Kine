export function SpeakerIcon({ muted, size = 16 }: { muted?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
      {!muted ? (
        <path d="M17 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
      ) : (
        <path d="M17 9l5 6M22 9l-5 6" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function CommentIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" strokeLinejoin="round" />
    </svg>
  );
}

export function ShareIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" strokeLinecap="round" />
    </svg>
  );
}
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z" strokeLinejoin="round" />
      <path d="M7 11l3.5-7a2 2 0 0 1 2-1c1.1 0 2 .9 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 18.3 20H7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function ThumbsDownIcon({ filled, size = 20 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
      <path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z" strokeLinejoin="round" />
      <path d="M17 13l-3.5 7a2 2 0 0 1-2 1c-1.1 0-2-.9-2-2v-4H4.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 5.7 4H17" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
