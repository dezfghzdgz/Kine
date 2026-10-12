'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage, type DictKey } from '@/lib/i18n';
import {
  APPEARANCE_EVENT,
  BACKDROPS,
  CARD_SIZES,
  CORNERS,
  DEFAULT_APPEARANCE,
  TEXT_SIZES,
  backdropImageFromFile,
  readAppearance,
  readBackdropImage,
  readTheme,
  saveAppearance,
  saveBackdropImage,
  saveTheme,
  type Appearance,
  type Backdrop,
  type CardSize,
  type Corners,
  type TextSize,
  type Theme,
} from '@/lib/appearance';
import { BRAND_PRESET_COLORS, currentBrandColor, saveBrandColor } from './BrandLogo';
import UiIcon from './UiIcon';
import { PanelHeading, WithHelp } from './HelpTip';

const BACKDROP_LABELS: Record<Backdrop, DictKey> = {
  auto: 'appearanceBackdropAuto',
  brand: 'appearanceBackdropBrand',
  night: 'appearanceBackdropNight',
  sunset: 'appearanceBackdropSunset',
  forest: 'appearanceBackdropForest',
  ocean: 'appearanceBackdropOcean',
  neon: 'appearanceBackdropNeon',
  image: 'appearanceBackdropImage',
};

const TEXT_LABELS: Record<TextSize, DictKey> = { s: 'appearanceTextS', m: 'appearanceTextM', l: 'appearanceTextL' };
const CORNER_LABELS: Record<Corners, DictKey> = { sharp: 'appearanceCornersSharp', normal: 'appearanceCornersNormal', round: 'appearanceCornersRound' };
const CARD_LABELS: Record<CardSize, DictKey> = { s: 'appearanceCardsS', m: 'appearanceCardsM', l: 'appearanceCardsL' };

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
  // Můj obrázek za sklem (data URL v paměti prohlížeče) a chyba při jeho uložení.
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const wallpaperInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => {
      setTheme(readTheme());
      setAppearance(readAppearance());
      setWallpaper(readBackdropImage());
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

  /** Můj obrázek: zmenší se a uloží do tohohle zařízení; pozadí skla se na něj přepne. */
  async function pickWallpaper(file: File) {
    setWallpaperError(null);
    const url = await backdropImageFromFile(file);
    if (!url) {
      setWallpaperError(t('appearanceImageUnreadable'));
      return;
    }
    if (!saveBackdropImage(url)) {
      setWallpaperError(t('appearanceImageTooBig'));
      return;
    }
    setWallpaper(url);
    change({ backdrop: 'image' });
  }

  function removeWallpaper() {
    saveBackdropImage(null);
    setWallpaper(null);
    if (appearance.backdrop === 'image') change({ backdrop: 'auto' });
  }

  /** Řada tlačítek "jedno z" (velikost písma, rohy, karty). */
  function segmented<T extends string>(label: DictKey, values: readonly T[], current: T, labels: Record<T, DictKey>, onPick: (value: T) => void, cls: string) {
    return (
      <div>
        <p className="appearance-label">{t(label)}</p>
        <div className={`appearance-themes ${cls}`} role="radiogroup" aria-label={t(label)}>
          {values.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={current === value} className={current === value ? 'active' : ''} onClick={() => onPick(value)}>
              {t(labels[value])}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const glass = appearance.look === 'glass';

  return (
    <div className="panel appearance-panel" id="appearance" style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <PanelHeading icon="palette" title={t('appearanceHeading')} help={t('appearanceDeviceNote')} />
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
            <WithHelp help={t('appearanceAutoHint')} className="appearance-label-help">
              <p className="appearance-label">{t('appearanceBackdropLabel')}</p>
            </WithHelp>
            <div className="appearance-backdrops" role="radiogroup" aria-label={t('appearanceBackdropLabel')}>
              {BACKDROPS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={appearance.backdrop === value}
                  className={`appearance-backdrop-chip ${appearance.backdrop === value ? 'active' : ''}`}
                  onClick={() => {
                    // Můj obrázek bez obrázku: rovnou výběr souboru.
                    if (value === 'image' && !wallpaper) wallpaperInput.current?.click();
                    else change({ backdrop: value });
                  }}
                >
                  <span
                    className={`appearance-swatch appearance-swatch-${value}`}
                    aria-hidden="true"
                    style={value === 'image' && wallpaper ? { backgroundImage: `url(${wallpaper})` } : undefined}
                  >
                    {value === 'image' && !wallpaper ? '+' : null}
                  </span>
                  {t(BACKDROP_LABELS[value])}
                </button>
              ))}
            </div>
            <input
              ref={wallpaperInput}
              type="file"
              accept="image/*"
              hidden
              className="appearance-wallpaper-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void pickWallpaper(file);
              }}
            />
            {wallpaperError && <p className="appearance-error">{wallpaperError}</p>}
          </div>

          {appearance.backdrop === 'image' && wallpaper && (
            <div className="appearance-wallpaper">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="appearance-reset" onClick={() => wallpaperInput.current?.click()}>
                  <UiIcon name="image" size={15} />
                  <span>{t('appearanceImageChange')}</span>
                </button>
                <button type="button" className="appearance-reset" onClick={removeWallpaper}>
                  <UiIcon name="close" size={15} />
                  <span>{t('appearanceImageRemove')}</span>
                </button>
              </div>
              <p className="appearance-label" style={{ marginTop: 12 }}>{t('appearanceBlurLabel')}</p>
              <label className="appearance-range">
                <span>{t('appearanceBlurLow')}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={appearance.blur}
                  onChange={(e) => change({ blur: Number(e.target.value) })}
                  aria-label={t('appearanceBlurLabel')}
                />
                <span>{t('appearanceBlurHigh')}</span>
              </label>
            </div>
          )}

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

          <WithHelp help={t('appearanceMotionHint')} className="settings-option">
            <label className="settings-check">
              <input type="checkbox" className="appearance-motion" checked={appearance.motion} onChange={(e) => change({ motion: e.target.checked })} />
              <UiIcon name="sparkle" size={16} />
              <span>{t('appearanceMotion')}</span>
            </label>
          </WithHelp>
        </>
      )}

      <WithHelp help={t('appearanceAmbientHint')} className="settings-option">
        <label className="settings-check">
          <input type="checkbox" className="appearance-ambient" checked={appearance.ambient} onChange={(e) => change({ ambient: e.target.checked })} />
          <UiIcon name="monitor" size={16} />
          <span>{t('appearanceAmbient')}</span>
        </label>
      </WithHelp>

      {/* Pozadí a světlo sledují obraz videa / přenosu (ne jen náhled). Má smysl se světlem nebo se sklem "podle videa". */}
      {(appearance.ambient || (glass && appearance.backdrop === 'auto')) && (
        <WithHelp help={t('appearanceFollowHint')} className="settings-option">
          <label className="settings-check">
            <input type="checkbox" className="appearance-follow" checked={appearance.follow} onChange={(e) => change({ follow: e.target.checked })} />
            <UiIcon name="eye" size={16} />
            <span>{t('appearanceFollow')}</span>
          </label>
        </WithHelp>
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

      {/* Velikost a tvar: písmo, rohy, karty videí - a klidný režim bez animací. */}
      {segmented('appearanceTextLabel', TEXT_SIZES, appearance.text, TEXT_LABELS, (v) => change({ text: v }), 'appearance-text')}
      {segmented('appearanceCornersLabel', CORNERS, appearance.corners, CORNER_LABELS, (v) => change({ corners: v }), 'appearance-corners')}
      {segmented('appearanceCardsLabel', CARD_SIZES, appearance.cards, CARD_LABELS, (v) => change({ cards: v }), 'appearance-cards')}

      <WithHelp help={t('appearanceCalmHint')} className="settings-option">
        <label className="settings-check">
          <input type="checkbox" className="appearance-calm" checked={appearance.calm} onChange={(e) => change({ calm: e.target.checked })} />
          <UiIcon name="pause" size={16} />
          <span>{t('appearanceCalm')}</span>
        </label>
      </WithHelp>

      <div>
        <button
          type="button"
          className="appearance-reset"
          onClick={() => {
            changeTheme('dark');
            change({ ...DEFAULT_APPEARANCE });
          }}
        >
          <UiIcon name="refresh" size={15} />
          <span>{t('appearanceReset')}</span>
        </button>
      </div>
    </div>
  );
}
