'use client';

import { useLanguage } from '@/lib/i18n';

export default function SupporterBadge({ isSupporter }: { isSupporter?: boolean | null }) {
  const { t } = useLanguage();
  if (!isSupporter) return null;

  return (
    <span
      title={t('supporterBadgeTitle')}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 5, fontSize: 13 }}
    >
      💛
    </span>
  );
}
