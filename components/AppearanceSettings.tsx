'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage, type DictKey } from '@/lib/i18n';
import {
  APPEARANCE_EVENT,
  AVATAR_MOTIONS,
  BACKDROPS,
  CARD_SIZES,
  CORNERS,
  DEFAULT_APPEARANCE,
  DENSITIES,
  FONTS,
  PATTERNS,
  TEXT_SIZES,
  PHOTO_STAMP_KEY,
  backdropImageFromFile,
  patternImageFromFile,
  photoFromFile,
  readAppearance,
  readBackdropImage,
  readPatternImage,
  readPhotoBlob,
  readTheme,
  saveAppearance,
  saveBackdropImage,
  savePatternImage,
  savePhotoBlob,
  saveTheme,
  type Appearance,
  type AvatarMotion,
  type Backdrop,
  type CardSize,
  type Corners,
  type Density,
  type FontChoice,
  type Pattern,
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
  aurora: 'appearanceBackdropAurora',
  candy: 'appearanceBackdropCandy',
  ember: 'appearanceBackdropEmber',
  mono: 'appearanceBackdropMono',
  image: 'appearanceBackdropImage',
};

const PATTERN_LABELS: Record<Pattern, DictKey> = {
  none: 'appearancePatternNone',
  dots: 'appearancePatternDots',
  grid: 'appearancePatternGrid',
  diagonal: 'appearancePatternDiagonal',
  waves: 'appearancePatternWaves',
  plus: 'appearancePatternPlus',
  circles: 'appearancePatternCircles',
  zigzag: 'appearancePatternZigzag',
  custom: 'appearancePatternCustom',
  photo: 'appearancePatternPhoto',
};

/**
 * Hotové motivy: jedním klikem motiv, styl, pozadí, vzor, písmo a barva appky
 * (pak jde cokoli doladit ručně). Náhled = barvy motivu.
 */
type Preset = {
  id: 'kine' | 'midnight' | 'neon' | 'forest' | 'paper' | 'sunset';
  label: DictKey;
  theme: Theme;
  brand: string;
  patch: Partial<Appearance>;
  preview: string;
};
const PRESETS: Preset[] = [
  { id: 'kine', label: 'appearancePresetKine', theme: 'dark', brand: '#00c9a7', patch: { look: 'classic', backdrop: 'auto', pattern: 'none', font: 'inter', corners: 'normal' }, preview: 'linear-gradient(135deg, #0b0b0e, #16161b)' },
  { id: 'midnight', label: 'appearancePresetMidnight', theme: 'dark', brand: '#8b5cf6', patch: { look: 'glass', backdrop: 'night', pattern: 'dots', patternStrength: 35, font: 'inter', corners: 'round' }, preview: 'linear-gradient(135deg, #0f0c29, #302b63)' },
  { id: 'neon', label: 'appearancePresetNeon', theme: 'dark', brand: '#ff2bd6', patch: { look: 'glass', backdrop: 'neon', pattern: 'grid', patternStrength: 30, font: 'mono', corners: 'sharp' }, preview: 'linear-gradient(135deg, #12002b, #ff2bd6 140%)' },
  { id: 'forest', label: 'appearancePresetForest', theme: 'gray', brand: '#22c55e', patch: { look: 'glass', backdrop: 'forest', pattern: 'waves', patternStrength: 30, font: 'rounded', corners: 'round' }, preview: 'linear-gradient(135deg, #0b2b1a, #2f6d3a)' },
  { id: 'paper', label: 'appearancePresetPaper', theme: 'light', brand: '#e11d48', patch: { look: 'classic', backdrop: 'auto', pattern: 'diagonal', patternStrength: 25, font: 'serif', corners: 'normal' }, preview: 'linear-gradient(135deg, #faf7f2, #ece5d8)' },
  { id: 'sunset', label: 'appearancePresetSunset', theme: 'dark', brand: '#f97316', patch: { look: 'glass', backdrop: 'sunset', pattern: 'none', font: 'inter', corners: 'round' }, preview: 'linear-gradient(135deg, #3a0d2e, #f97316)' },
];

const TEXT_LABELS: Record<TextSize, DictKey> = { s: 'appearanceTextS', m: 'appearanceTextM', l: 'appearanceTextL' };
const CORNER_LABELS: Record<Corners, DictKey> = { sharp: 'appearanceCornersSharp', normal: 'appearanceCornersNormal', round: 'appearanceCornersRound' };
const CARD_LABELS: Record<CardSize, DictKey> = { s: 'appearanceCardsS', m: 'appearanceCardsM', l: 'appearanceCardsL' };
const DENSITY_LABELS: Record<Density, DictKey> = { compact: 'appearanceDensityCompact', normal: 'appearanceDensityNormal', comfy: 'appearanceDensityComfy' };
const AVATAR_LABELS: Record<AvatarMotion, DictKey> = { always: 'appearanceAvatarsAlways', hover: 'appearanceAvatarsHover', never: 'appearanceAvatarsNever' };
const FONT_LABELS: Record<FontChoice, DictKey> = {
  inter: 'appearanceFontInter',
  system: 'appearanceFontSystem',
  rounded: 'appearanceFontRounded',
  serif: 'appearanceFontSerif',
  mono: 'appearanceFontMono',
};
/** Každá volba písma je napsaná tím písmem - je hned vidět, jak vypadá. */
const FONT_PREVIEW: Record<FontChoice, string> = {
  inter: "var(--font-inter, 'Inter'), sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', 'Roboto', sans-serif",
  rounded: "'Kine Rounded', ui-rounded, system-ui, sans-serif",
  serif: "'Kine Serif', Georgia, serif",
  mono: "'Kine Mono', ui-monospace, monospace",
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
  // Můj obrázek za sklem (data URL v paměti prohlížeče) a chyba při jeho uložení.
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const wallpaperInput = useRef<HTMLInputElement>(null);
  // Vlastní vzor (dlaždice, data URL v paměti prohlížeče).
  const [patternImage, setPatternImage] = useState<string | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const patternInput = useRef<HTMLInputElement>(null);
  // Jedna fotka / GIF přes celé pozadí (soubor v IndexedDB; tady jen adresa pro náhled).
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoStamp, setPhotoStamp] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => {
      setTheme(readTheme());
      setAppearance(readAppearance());
      setWallpaper(readBackdropImage());
      setPatternImage(readPatternImage());
      let stamp: string | null = null;
      try {
        stamp = window.localStorage.getItem(PHOTO_STAMP_KEY);
      } catch {
        stamp = null;
      }
      setPhotoStamp(stamp);
    };
    sync();
    setBrand(currentBrandColor());
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);

  // Náhled uložené fotky / GIFu (jen když se fotka změní).
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    void readPhotoBlob().then((blob) => {
      if (cancelled) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setPhotoUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoStamp]);

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

  /** Vlastní vzor: zmenší se na dlaždici a uloží do zařízení; vzor se na něj přepne. */
  async function pickPattern(file: File) {
    setPatternError(null);
    const url = await patternImageFromFile(file);
    if (!url) {
      setPatternError(t('appearanceImageUnreadable'));
      return;
    }
    if (!savePatternImage(url)) {
      setPatternError(t('appearanceImageTooBig'));
      return;
    }
    setPatternImage(url);
    change({ pattern: 'custom' });
  }

  /** Fotka / GIF přes celé pozadí: fotka se zmenší, GIF zůstane (jinak by se zastavil); vzor se na ni přepne. */
  async function pickPhoto(file: File) {
    setPatternError(null);
    setPhotoBusy(true);
    try {
      const result = await photoFromFile(file);
      if ('error' in result) {
        setPatternError(result.error === 'too-big' ? t('appearancePhotoTooBig') : t('appearanceImageUnreadable'));
        return;
      }
      if (!(await savePhotoBlob(result.blob))) {
        setPatternError(t('appearanceImageTooBig'));
        return;
      }
      change({ pattern: 'photo' });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    await savePhotoBlob(null);
    setPhotoUrl(null);
    if (appearance.pattern === 'photo') change({ pattern: 'none' });
  }

  function applyPreset(preset: Preset) {
    changeTheme(preset.theme);
    change({ patternStrength: DEFAULT_APPEARANCE.patternStrength, ...preset.patch });
    changeBrand(preset.brand);
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

      {/* Hotové motivy - jedním klikem; pak jde cokoli doladit níž. */}
      <div>
        <p className="appearance-label">{t('appearancePresetsLabel')}</p>
        <div className="appearance-presets">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="appearance-preset" data-preset={preset.id} onClick={() => applyPreset(preset)}>
              <span className="appearance-preset-preview" style={{ background: preset.preview }} aria-hidden="true">
                <i style={{ background: preset.brand }} />
              </span>
              <span>{t(preset.label)}</span>
            </button>
          ))}
        </div>
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

      {/* Vzor přes pozadí celé appky (oba vzhledy) - vestavěný v barvě appky, nebo vlastní obrázek. */}
      <div>
        <WithHelp help={t('appearancePatternHint')} className="appearance-label-help">
          <p className="appearance-label">{t('appearancePatternLabel')}</p>
        </WithHelp>
        <div className="appearance-patterns" role="radiogroup" aria-label={t('appearancePatternLabel')}>
          {PATTERNS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={appearance.pattern === value}
              className={`appearance-pattern-chip ${appearance.pattern === value ? 'active' : ''}`}
              data-pattern={value}
              onClick={() => {
                // Vlastní vzor / fotka bez obrázku: rovnou výběr souboru.
                if (value === 'custom' && !patternImage) patternInput.current?.click();
                else if (value === 'photo' && !photoUrl) photoInput.current?.click();
                else change({ pattern: value });
              }}
            >
              <span
                className={`appearance-pattern-swatch appearance-pattern-swatch-${value}`}
                aria-hidden="true"
                style={
                  value === 'custom' && patternImage
                    ? { backgroundImage: `url(${patternImage})` }
                    : value === 'photo' && photoUrl
                      ? { backgroundImage: `url(${photoUrl})` }
                      : undefined
                }
              >
                {(value === 'custom' && !patternImage) || (value === 'photo' && !photoUrl) ? (
                  <UiIcon name={value === 'photo' ? 'image' : 'plus'} size={16} />
                ) : value === 'none' ? (
                  <UiIcon name="close" size={14} />
                ) : null}
              </span>
              {t(PATTERN_LABELS[value])}
            </button>
          ))}
        </div>
        <input
          ref={patternInput}
          type="file"
          accept="image/*"
          hidden
          className="appearance-pattern-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void pickPattern(file);
          }}
        />
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          className="appearance-photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void pickPhoto(file);
          }}
        />
        {photoBusy && <p className="appearance-label" style={{ marginTop: 8 }}>{t('appearancePhotoSaving')}</p>}
        {patternError && <p className="appearance-error">{patternError}</p>}
        {appearance.pattern !== 'none' && (
          <div className="appearance-wallpaper">
            {appearance.pattern === 'photo' && photoUrl && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" className="appearance-reset" onClick={() => photoInput.current?.click()}>
                  <UiIcon name="image" size={15} />
                  <span>{t('appearanceImageChange')}</span>
                </button>
                <button type="button" className="appearance-reset appearance-photo-remove" onClick={() => void removePhoto()}>
                  <UiIcon name="close" size={15} />
                  <span>{t('appearanceImageRemove')}</span>
                </button>
              </div>
            )}
            {appearance.pattern === 'custom' && patternImage && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" className="appearance-reset" onClick={() => patternInput.current?.click()}>
                  <UiIcon name="image" size={15} />
                  <span>{t('appearanceImageChange')}</span>
                </button>
                <button
                  type="button"
                  className="appearance-reset"
                  onClick={() => {
                    savePatternImage(null);
                    setPatternImage(null);
                    change({ pattern: 'none' });
                  }}
                >
                  <UiIcon name="close" size={15} />
                  <span>{t('appearanceImageRemove')}</span>
                </button>
              </div>
            )}
            <p className="appearance-label">{t('appearancePatternStrength')}</p>
            <label className="appearance-range">
              <span>{t('appearancePatternSubtle')}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={appearance.patternStrength}
                onChange={(e) => change({ patternStrength: Number(e.target.value) })}
                aria-label={t('appearancePatternStrength')}
              />
              <span>{t('appearancePatternBold')}</span>
            </label>
            {appearance.pattern !== 'photo' && <p className="appearance-label" style={{ marginTop: 12 }}>{t('appearancePatternSize')}</p>}
            {appearance.pattern !== 'photo' && (
            <label className="appearance-range">
              <span>{t('appearancePatternSmaller')}</span>
              <input
                type="range"
                min={50}
                max={200}
                step={10}
                value={appearance.patternScale}
                onChange={(e) => change({ patternScale: Number(e.target.value) })}
                aria-label={t('appearancePatternSize')}
              />
              <span>{t('appearancePatternBigger')}</span>
            </label>
            )}
          </div>
        )}
      </div>

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

      {/* Písmo: každá volba je napsaná svým písmem. */}
      <div>
        <p className="appearance-label">{t('appearanceFontLabel')}</p>
        <div className="appearance-themes appearance-font" role="radiogroup" aria-label={t('appearanceFontLabel')}>
          {FONTS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={appearance.font === value}
              className={appearance.font === value ? 'active' : ''}
              style={{ fontFamily: FONT_PREVIEW[value] }}
              onClick={() => change({ font: value })}
            >
              {t(FONT_LABELS[value])}
            </button>
          ))}
        </div>
      </div>

      {/* Velikost a tvar: písmo, rohy, karty videí, rozestupy - a klidný režim bez animací. */}
      {segmented('appearanceTextLabel', TEXT_SIZES, appearance.text, TEXT_LABELS, (v) => change({ text: v }), 'appearance-text')}
      {segmented('appearanceCornersLabel', CORNERS, appearance.corners, CORNER_LABELS, (v) => change({ corners: v }), 'appearance-corners')}
      {segmented('appearanceCardsLabel', CARD_SIZES, appearance.cards, CARD_LABELS, (v) => change({ cards: v }), 'appearance-cards')}
      {segmented('appearanceDensityLabel', DENSITIES, appearance.density, DENSITY_LABELS, (v) => change({ density: v }), 'appearance-density')}
      {segmented('appearanceAvatarsLabel', AVATAR_MOTIONS, appearance.avatars, AVATAR_LABELS, (v) => change({ avatars: v }), 'appearance-avatars')}

      {/* Náhledy po najetí jsou teď v Nastavení -> Přehrávání (components/PlaybackSettings.tsx). */}

      <WithHelp help={t('appearanceContrastHint')} className="settings-option">
        <label className="settings-check">
          <input type="checkbox" className="appearance-contrast" checked={appearance.contrast} onChange={(e) => change({ contrast: e.target.checked })} />
          <UiIcon name="sun" size={16} />
          <span>{t('appearanceContrast')}</span>
        </label>
      </WithHelp>

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
