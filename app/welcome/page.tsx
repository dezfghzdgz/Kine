'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, type DictKey } from '@/lib/i18n';
import UiIcon, { type UiIconName } from '@/components/UiIcon';
import { firstWelcomeStep, WELCOME_STEPS, type WelcomeProfile, type WelcomeStep } from '@/lib/welcome';

/**
 * Vítání po první registraci - jedna stránka s průvodcem místo čtyř
 * samostatných (pravidla, k čemu Kine chceš, hodnocení, co sleduješ).
 * Nahoře je vidět, kolik kroků zbývá; jde se vrátit; hodnocení a obsah se
 * dají přeskočit (zůstane výchozí). Na konci rozcestník: prozkoumat,
 * nahrát první video, vzhled, appka do PC.
 *
 * Kdo má něco už vyplněné (třeba po přihlášení na jiném zařízení), začne
 * u prvního nevyplněného kroku (lib/welcome.ts). Staré adresy
 * (/agree-to-rules, /choose-purpose...) sem přesměrují.
 */

type Choice = { value: string; icon: UiIconName; title: string; desc: string };

export default function WelcomePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<(WelcomeProfile & { username: string | null }) | null>(null);
  const [step, setStep] = useState<WelcomeStep | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace('/login?next=/welcome');
        return;
      }
      setUserId(data.user.id);
      const [{ data: row }, { data: accountRows }] = await Promise.all([
        supabase.from('profiles').select('username, viewer_type, rating_mode, content_preference').eq('id', data.user.id).maybeSingle(),
        supabase.rpc('my_account'),
      ]);
      const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;
      const p = {
        username: (row as any)?.username ?? null,
        agreedToRules: !!account?.agreed_to_rules,
        viewerType: (row as any)?.viewer_type ?? null,
        ratingMode: (row as any)?.rating_mode ?? null,
        contentPreference: (row as any)?.content_preference ?? null,
      };
      setProfile(p);
      setStep(firstWelcomeStep(p));
    })();
  }, [router]);

  /** Uloží krok a jde na první nevyplněný (když je všechno, na "hotovo"). */
  async function save(patch: Record<string, unknown>, updated: Partial<WelcomeProfile>) {
    if (!userId || !profile) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.from('profiles').update(patch).eq('id', userId);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    const next = { ...profile, ...updated };
    setProfile(next);
    setStep(firstWelcomeStep(next));
  }

  if (!profile || !step) return <p style={{ color: 'var(--text-faint)', textAlign: 'center', marginTop: 80 }}>…</p>;

  const index = WELCOME_STEPS.indexOf(step);
  const questions = WELCOME_STEPS.length - 1; // poslední je "hotovo"
  const back = index > 0 && step !== 'done' ? WELCOME_STEPS[index - 1] : null;

  const choices = (items: Choice[], current: string | null, onPick: (value: string) => void) => (
    <div className="welcome-choices">
      {items.map((c) => (
        <button key={c.value} type="button" className={`welcome-choice ${current === c.value ? 'active' : ''}`} disabled={saving} onClick={() => onPick(c.value)}>
          <span className="welcome-choice-icon" aria-hidden="true">
            <UiIcon name={c.icon} size={24} />
          </span>
          <span className="welcome-choice-title">{c.title}</span>
          <span className="welcome-choice-desc">{c.desc}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="welcome">
      {step !== 'done' && (
        <div className="welcome-progress" aria-label={t('welcomeStep').replace('{n}', String(index + 1)).replace('{total}', String(questions))}>
          {WELCOME_STEPS.slice(0, questions).map((s, i) => (
            <span key={s} className={`welcome-dot ${i < index ? 'done' : i === index ? 'current' : ''}`} />
          ))}
          <span className="welcome-progress-text">{t('welcomeStep').replace('{n}', String(index + 1)).replace('{total}', String(questions))}</span>
        </div>
      )}

      {step === 'rules' && (
        <section className="welcome-card">
          <span className="welcome-badge" aria-hidden="true">
            <UiIcon name="shield" size={26} />
          </span>
          <h1>{t('welcomeRulesTitle').replace('{name}', profile.username ?? '')}</h1>
          <p className="welcome-lead">{t('welcomeRulesIntro')}</p>
          <div className="welcome-rules">
            <div>
              <p className="welcome-rules-head ok">
                <UiIcon name="check" size={16} /> {t('welcomeRulesOkTitle')}
              </p>
              <p>{t('welcomeRulesOk')}</p>
            </div>
            <div>
              <p className="welcome-rules-head no">
                <UiIcon name="close" size={16} /> {t('welcomeRulesNoTitle')}
              </p>
              <p>{t('welcomeRulesNo')}</p>
            </div>
          </div>
          <p className="welcome-small">
            {t('welcomeRulesLegal')}{' '}
            <Link href="/rules" target="_blank">{t('welcomeRulesLink')}</Link> · <Link href="/terms" target="_blank">{t('termsOfService')}</Link> ·{' '}
            <Link href="/privacy" target="_blank">{t('privacyPolicy')}</Link>
          </p>
          <button
            type="button"
            className="welcome-primary"
            disabled={saving}
            onClick={() => save({ agreed_to_rules: true, agreed_to_rules_at: new Date().toISOString() }, { agreedToRules: true })}
          >
            {saving ? '…' : t('welcomeRulesAgree')}
          </button>
        </section>
      )}

      {step === 'purpose' && (
        <section className="welcome-card">
          <h1>{t('purposeTitle')}</h1>
          <p className="welcome-lead">{t('purposeIntro')}</p>
          {choices(
            [
              { value: 'viewer', icon: 'play', title: t('wantToWatch'), desc: t('wantToWatchDesc') },
              { value: 'creator', icon: 'film', title: t('wantToCreate'), desc: t('wantToCreateDesc') },
            ],
            profile.viewerType,
            (value) => void save({ viewer_type: value }, { viewerType: value })
          )}
        </section>
      )}

      {step === 'rating' && (
        <section className="welcome-card">
          <h1>{t('ratingModeTitle')}</h1>
          <p className="welcome-lead">{t('ratingModeIntro')}</p>
          {choices(
            [
              { value: 'like_dislike', icon: 'heart', title: t('welcomeLikeDislike'), desc: t('likeDislikeDesc') },
              { value: 'stars', icon: 'starFilled', title: t('starsLabel'), desc: t('starsDesc') },
            ],
            profile.ratingMode,
            (value) => void save({ rating_mode: value }, { ratingMode: value })
          )}
        </section>
      )}

      {step === 'content' && (
        <section className="welcome-card">
          <h1>{t('contentPrefTitle')}</h1>
          <p className="welcome-lead">{t('contentPrefIntro')}</p>
          {choices(
            [
              { value: 'long', icon: 'film', title: t('longerVideosLabel'), desc: t('longVideosDesc') },
              { value: 'short', icon: 'bolt', title: 'Sparks', desc: t('sparksDesc') },
            ],
            profile.contentPreference,
            (value) => void save({ content_preference: value }, { contentPreference: value })
          )}
        </section>
      )}

      {step === 'done' && (
        <section className="welcome-card">
          <span className="welcome-badge done" aria-hidden="true">
            <UiIcon name="check" size={26} />
          </span>
          <h1>{t('welcomeDoneTitle')}</h1>
          <p className="welcome-lead">{t('welcomeDoneIntro')}</p>
          <div className="welcome-next">
            {(
              [
                { href: '/explore', icon: 'search', key: 'welcomeNextExplore' },
                ...(profile.viewerType === 'creator' ? [{ href: '/upload', icon: 'upload', key: 'welcomeNextUpload' }] : []),
                { href: '/live', icon: 'broadcast', key: 'welcomeNextLive' },
                { href: '/settings#appearance', icon: 'palette', key: 'welcomeNextLook' },
                { href: '/download', icon: 'desktop', key: 'welcomeNextApp' },
              ] as { href: string; icon: UiIconName; key: DictKey }[]
            ).map((n) => (
              <Link key={n.href} href={n.href} className="welcome-next-item">
                <UiIcon name={n.icon} size={18} />
                <span>{t(n.key)}</span>
              </Link>
            ))}
          </div>
          <button
            type="button"
            className="welcome-primary"
            onClick={() => {
              router.push('/');
              router.refresh();
            }}
          >
            {t('welcomeStart')}
          </button>
        </section>
      )}

      {error && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}

      {step !== 'done' && (
        <div className="welcome-footer">
          {back ? (
            <button type="button" className="welcome-link" onClick={() => setStep(back)} disabled={saving}>
              ← {t('welcomeBack')}
            </button>
          ) : (
            <span />
          )}
          {(step === 'rating' || step === 'content') && (
            <button
              type="button"
              className="welcome-link"
              disabled={saving}
              onClick={() => {
                const rating = profile.ratingMode ?? 'like_dislike';
                const content = profile.contentPreference ?? 'long';
                if (step === 'rating') void save({ rating_mode: rating }, { ratingMode: rating });
                else void save({ content_preference: content }, { contentPreference: content });
              }}
            >
              {t('welcomeSkip')} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
