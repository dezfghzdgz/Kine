'use client';

import { useEffect, useState } from 'react';
import { useLanguage, type DictKey } from '@/lib/i18n';
import {
  APPEARANCE_EVENT,
  BACKDROPS,
  DEFAULT_APPEARANCE,
  readAppearance,
  readTheme,
  saveAppearance,
  saveTheme,
  type Appearance,
  type Backdrop,
  type Theme,
} from '@/lib/appearance';
import { BRAND_PRESET_COLORS, currentBrandColor, saveBrandColor } from './BrandLogo';

const BACKDROP_LABELS: Record<Backdrop, DictKey> = {
  auto: 'appearanceBackdropAuto',
  brand: 'appearanceBackdropBrand',
  night: 'appearanceBackdropNight',
  sunset: 'appearanceBackdropSunset',
  forest: 'appearanceBackdropForest',
  ocean: 'appearanceBackdropOcean',
  neon: 'appearanceBackdropNeon',
};

/**
 * Nastavení -> Vzhled: motiv, klasický / skleněný styl, pozadí skla,
 * průhlednost, ambientní světlo u videa a barva appky. Všechno se projeví
 * hned (bez ukládání formuláře) a pamatuje si to tohle zařízení
 * (lib/appearance.ts); barva jde i k účtu.
 */
export default function AppearanceSettings() {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<Theme>('dark');
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [brand, setBrand] = useState<string>('#00c9a7');

  useEffect(() => {
    const sync = () => {
      setTheme(readTheme());
      setAppearance(readAppearance());
    };
    sync();
    setBrand(currentBrandColor());
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);

  function change(patch: Partial<Appearance>) {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    saveAppearance(next);
  }

  function changeTheme(next: Theme) {
    setTheme(next);
    saveTheme(next);
  }

  function changeBrand(color: string) {
    setBrand(color);
    void saveBrandColor(color);
  }

  const glass = appearance.look === 'glass';

  return (
    <div className="panel appearance-panel" id="appearance" style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <p className="panel-heading" style={{ marginBottom: 4 }}>{t('appearanceHeading')}</p>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{t('appearanceDeviceNote')}</p>
      </div>

      <div>
        <p className="appearance-label">{t('appearanceThemeLabel')}</p>
        <div className="appearance-themes" role="radiogroup" aria-label={t('appearanceThemeLabel')}>
          {(['dark', 'gray', 'light'] as Theme[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={theme === value ? 'active' : ''}
              onClick={() => changeTheme(value)}
            >
              {t(value === 'dark' ? 'themeDark' : value === 'gray' ? 'themeGray' : 'themeLight')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="appearance-label">{t('appearanceStyleLabel')}</p>
        <div className="appearance-options" role="radiogroup" aria-label={t('appearanceStyleLabel')}>
          <button type="button" role="radio" aria-checked={!glass} className={`appearance-option ${!glass ? 'active' : ''}`} onClick={() => change({ look: 'classic' })}>
            <span className="appearance-preview" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{t('appearanceClassic')}</span>
            <span className="appearance-option-hint">{t('appearanceClassicHint')}</span>
          </button>
          <button type="button" role="radio" aria-checked={glass} className={`appearance-option ${glass ? 'active' : ''}`} onClick={() => change({ look: 'glass' })}>
            <span className="appearance-preview appearance-preview-glass" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{t('appearanceGlass')}</span>
            <span className="appearance-option-hint">{t('appearanceGlassHint')}</span>
          </button>
        </div>
      </div>

      {glass && (
        <>
          <div>
            <p className="appearance-label">{t('appearanceBackdropLabel')}</p>
            <div className="appearance-backdrops" role="radiogroup" aria-label={t('appearanceBackdropLabel')}>
              {BACKDROPS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={appearance.backdrop === value}
                  className={`appearance-backdrop-chip ${appearance.backdrop === value ? 'active' : ''}`}
                  onClick={() => change({ backdrop: value })}
                >
                  <span className={`appearance-swatch appearance-swatch-${value}`} aria-hidden="true" />
                  {t(BACKDROP_LABELS[value])}
                </button>
              ))}
            </div>
            {appearance.backdrop === 'auto' && <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '8px 0 0' }}>{t('appearanceAutoHint')}</p>}
          </div>

          <div>
            <p className="appearance-label">{t('appearanceStrengthLabel')}</p>
            <label className="appearance-range">
              <span>{t('appearanceStrengthLow')}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={appearance.strength}
                onChange={(e) => change({ strength: Number(e.target.value) })}
                aria-label={t('appearanceStrengthLabel')}
              />
              <span>{t('appearanceStrengthHigh')}</span>
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <input type="checkbox" className="appearance-motion" style={{ width: 'auto', marginTop: 2 }} checked={appearance.motion} onChange={(e) => change({ motion: e.target.checked })} />
            <span>
              {t('appearanceMotion')}
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{t('appearanceMotionHint')}</span>
            </span>
          </label>
        </>
      )}

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
        <input type="checkbox" style={{ width: 'auto', marginTop: 2 }} checked={appearance.ambient} onChange={(e) => change({ ambient: e.target.checked })} />
        <span>
          {t('appearanceAmbient')}
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{t('appearanceAmbientHint')}</span>
        </span>
      </label>

      {/* Pozadí a světlo sledují obraz videa / přenosu (ne jen náhled). Má smysl se světlem nebo se sklem "podle videa". */}
      {(appearance.ambient || (glass && appearance.backdrop === 'auto')) && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
          <input type="checkbox" className="appearance-follow" style={{ width: 'auto', marginTop: 2 }} checked={appearance.follow} onChange={(e) => change({ follow: e.target.checked })} />
          <span>
            {t('appearanceFollow')}
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)' }}>{t('appearanceFollowHint')}</span>
          </span>
        </label>
      )}

      <div>
        <p className="appearance-label">{t('appearanceColorLabel')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {BRAND_PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => changeBrand(c)}
              className="appearance-color"
              aria-label={c}
              aria-pressed={brand.toLowerCase() === c}
              style={{ background: c }}
            />
          ))}
          <label className="appearance-color appearance-color-custom" title={t('appearanceColorCustom')}>
            +
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(brand) ? brand : '#00c9a7'} onChange={(e) => changeBrand(e.target.value)} aria-label={t('appearanceColorCustom')} />
          </label>
        </div>
      </div>

      <div>
        <button
          type="button"
          className="appearance-reset"
          onClick={() => {
            changeTheme('dark');
            change({ ...DEFAULT_APPEARANCE });
          }}
        >
          {t('appearanceReset')}
        </button>
      </div>
    </div>
  );
}
