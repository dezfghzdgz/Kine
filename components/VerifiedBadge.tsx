const TIER_COLORS: Record<string, string> = {
  basic: '#9a9aa0',
  silver: '#c7c9cc',
  blue: '#4a9eff',
};

const TIER_NAMES: Record<string, string> = {
  basic: 'Ověřený tvůrce',
  silver: 'Ověřený tvůrce (stříbrná úroveň)',
  blue: 'Ověřený tvůrce (modrá úroveň)',
};

export default function VerifiedBadge({ tier }: { tier?: string | null }) {
  if (!tier || tier === 'none') return null;

  const color = TIER_COLORS[tier] ?? TIER_COLORS.basic;

  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 5 }}
    >
      <title>{TIER_NAMES[tier] ?? 'Ověřený tvůrce'}</title>
      <path
        d="M12 2l2.4 2.1 3.1-.6 1 3 2.8 1.5-.5 3.1 1.7 2.6-1.7 2.6.5 3.1-2.8 1.5-1 3-3.1-.6L12 22l-2.4-2.1-3.1.6-1-3-2.8-1.5.5-3.1L1.5 12l1.7-2.6-.5-3.1 2.8-1.5 1-3 3.1.6L12 2z"
        fill={color}
      />
      <path
        d="M8.5 12.5l2.3 2.3 4.7-5.1"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
