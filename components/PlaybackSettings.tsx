'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { dataSaverPref, setDataSaverPref, type DataSaverPref } from '@/lib/netQuality';
import { APPEARANCE_EVENT, readAppearance, saveAppearance } from '@/lib/appearance';
import { PanelHeading, WithHelp } from './HelpTip';
import UiIcon, { type UiIconName } from './UiIcon';

const OPTIONS: { value: DataSaverPref; icon: UiIconName; key: 'playbackQualityAuto' | 'playbackQualitySave' | 'playbackQualityBest' }[] = [
  { value: 'auto', icon: 'sparkle', key: 'playbackQualityAuto' },
  { value: 'save', icon: 'leaf', key: 'playbackQualitySave' },
  { value: 'best', icon: 'film', key: 'playbackQualityBest' },
];

/**
 * Přehrávání (Nastavení -> Přehrávání): kvalita videa podle připojení
 * (lib/netQuality.ts) a náhledy po najetí myší (uložené se vzhledem,
 * lib/appearance.ts - dřív byly ve Vzhledu). Platí pro toto zařízení
 * (telefon na datech, počítač na wifi), proto se neukládá k účtu.
 */
export default function PlaybackSettings() {
  const { t } = useLanguage();
  const [pref, setPref] = useState<DataSaverPref>('auto');
  const [previews, setPreviews] = useState(true);

  useEffect(() => {
    setPref(dataSaverPref());
    const sync = () => setPreviews(readAppearance().previews);
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);

  function choose(value: DataSaverPref) {
    setPref(value);
    setDataSaverPref(value);
  }

  function changePreviews(on: boolean) {
    setPreviews(on);
    saveAppearance({ ...readAppearance(), previews: on });
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
      <WithHelp help={t('appearancePreviewsHint')} className="settings-option">
        <label className="settings-check">
          <input type="checkbox" className="appearance-previews" checked={previews} onChange={(e) => changePreviews(e.target.checked)} />
          <UiIcon name="play" size={16} />
          <span>{t('appearancePreviews')}</span>
        </label>
      </WithHelp>
    </div>
  );
}
