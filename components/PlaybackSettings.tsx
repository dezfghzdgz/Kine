'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { dataSaverPref, setDataSaverPref, type DataSaverPref } from '@/lib/netQuality';
import { PanelHeading } from './HelpTip';
import UiIcon, { type UiIconName } from './UiIcon';

const OPTIONS: { value: DataSaverPref; icon: UiIconName; key: 'playbackQualityAuto' | 'playbackQualitySave' | 'playbackQualityBest' }[] = [
  { value: 'auto', icon: 'sparkle', key: 'playbackQualityAuto' },
  { value: 'save', icon: 'leaf', key: 'playbackQualitySave' },
  { value: 'best', icon: 'film', key: 'playbackQualityBest' },
];

/**
 * Kvalita videa podle připojení (lib/netQuality.ts) - platí pro toto
 * zařízení (telefon na datech, počítač na wifi), proto se neukládá k účtu.
 */
export default function PlaybackSettings() {
  const { t } = useLanguage();
  const [pref, setPref] = useState<DataSaverPref>('auto');

  useEffect(() => {
    setPref(dataSaverPref());
  }, []);

  function choose(value: DataSaverPref) {
    setPref(value);
    setDataSaverPref(value);
  }

  return (
    <div className="panel" id="playback">
      <PanelHeading icon="play" title={t('playbackHeading')} help={t('playbackQualityHelp')} />
      <div className="settings-choices settings-choices-3" role="radiogroup" aria-label={t('playbackHeading')}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            className={`settings-choice${pref === o.value ? ' active' : ''}`}
            onClick={() => choose(o.value)}
          >
            <UiIcon name={o.icon} size={18} />
            <span>{t(o.key)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
