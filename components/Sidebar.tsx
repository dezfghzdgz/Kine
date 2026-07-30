'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { useMobileNav } from '@/lib/mobileNavContext';
import BrandLogo from './BrandLogo';
import ProfileMenu from './ProfileMenu';
import NotificationBell from './NotificationBell';
import SparksNavButton from './SparksNavButton';
import { useUserRole } from '@/lib/useUserRole';
import { FireIcon, SparkleIcon, DiceIcon, TagIcon } from './ReactionIcons';

function baseLinks(t: (key: any) => string) {
  return [
    { href: '/', label: t('home'), icon: HomeIcon },
  ];
}

const EXPLORE_TABS = [
  { tab: 'trending', key: 'trending', icon: FireIcon },
  { tab: 'newest', key: 'newest', icon: SparkleIcon },
  { tab: 'surprise', key: 'surprise', icon: DiceIcon },
];

const EXPLORE_CATEGORY_KEYS = [
  'catCars', 'catTravel', 'catFilm', 'catGaming', 'catMusic',
  'catComedy', 'catPeople', 'catHowTo', 'catNonprofit', 'catSports',
  'catScience', 'catEducation', 'catEntertainment', 'catNews', 'catPets',
];

function loggedInLinksGroup1(t: (key: any) => string) {
  return [
    { href: '/subscriptions', label: t('subscriptions'), icon: SubscribersIcon },
    { href: '/playlists', label: t('playlists'), icon: PlaylistIcon },
    { href: '/watch-later', label: t('watchLater'), icon: WatchLaterIcon },
    { href: '/activity', label: t('yourActivity'), icon: LikedIcon },
  ];
}

function loggedInLinksGroup2(t: (key: any) => string) {
  return [
    { href: '/downloaded', label: t('downloaded'), icon: DownloadIcon },
    { href: '/your-videos', label: t('yourVideos'), icon: YourVideosIcon },
  ];
}

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { isModerator } = useUserRole();
  const [exploreOpen, setExploreOpen] = useState(false);
  const { open: mobileNavOpen, close: closeMobileNav } = useMobileNav();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; username: string; avatar_url: string | null } | null>(null);
  const [ratingMode, setRatingMode] = useState<'stars' | 'like_dislike'>('like_dislike');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Znovu načíst při každé navigaci - kdyby se něco změnilo (např. rating_mode
  // v Nastavení), levé menu to hned zohlední, i když appka mezitím neproběhla
  // úplným znovunačtením.
  useEffect(() => {
    loadUser();
  }, [pathname]);

  async function loadUser() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setUser(null);
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, avatar_url, rating_mode')
      .eq('id', authData.user.id)
      .single();

    setUser({
      id: authData.user.id,
      username: profile?.username ?? authData.user.email ?? 'uživatel',
      avatar_url: profile?.avatar_url ?? null,
    });
    setRatingMode((profile?.rating_mode as 'stars' | 'like_dislike') ?? 'like_dislike');
    setLoading(false);
  }

  return (
    <>
    <aside className="sidebar">
      <div className="sidebar-logo-row">
        <BrandLogo className="sidebar-logo" />
        <span style={{ fontSize: 10, color: 'var(--text-faint)', marginLeft: 6, fontWeight: 600 }}>BETA0.088</span>
      </div>
      <nav className="sidebar-nav" style={{ flex: 1 }}>
        {baseLinks(t).map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={`sidebar-link ${active ? 'active' : ''}`}>
              <Icon />
              {label}
            </Link>
          );
        })}

        <button
          className={`sidebar-link ${pathname === '/explore' ? 'active' : ''}`}
          onClick={() => setExploreOpen((v) => !v)}
          style={{ justifyContent: 'space-between' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ExploreIcon />
            {t('explore')}
          </span>
          <span style={{ fontSize: 11, transform: exploreOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>▾</span>
        </button>
        {exploreOpen && (
          <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
            {EXPLORE_TABS.map(({ tab, key, icon: Icon }) => (
              <Link key={tab} href={`/explore?tab=${tab}`} className="sidebar-link" style={{ fontSize: 13.5, padding: '8px 14px' }}>
                <Icon size={15} />
                {t(key as any)}
              </Link>
            ))}
            {EXPLORE_CATEGORY_KEYS.map((catKey) => (
              <Link key={catKey} href={`/explore?category=${catKey}`} className="sidebar-link" style={{ fontSize: 13.5, padding: '8px 14px' }}>
                <TagIcon size={15} />
                {t(catKey as any)}
              </Link>
            ))}
          </div>
        )}

        {user && (
          <>
            <div className="sidebar-divider" />
            {loggedInLinksGroup1(t).map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link key={href} href={href} className={`sidebar-link ${active ? 'active' : ''}`}>
                  <Icon />
                  {label}
                </Link>
              );
            })}

            <div className="sidebar-divider" />
            {loggedInLinksGroup2(t).map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link key={href} href={href} className={`sidebar-link ${active ? 'active' : ''}`}>
                  <Icon />
                  {label}
                </Link>
              );
            })}
          </>
        )}

        <div className="sidebar-divider" />
        <Link href="/upload" className={`sidebar-link ${pathname === '/upload' ? 'active' : ''}`}>
          <CreateIcon />
          {t('create')}
        </Link>
        {user && (
          <Link href="/donate" className={`sidebar-link ${pathname === '/donate' ? 'active' : ''}`}>
            💛 {t('donateSidebarLabel')}
          </Link>
        )}
        {isModerator && (
          <Link href="/moderation/reports" className={`sidebar-link ${pathname === '/moderation/reports' ? 'active' : ''}`}>
            🚩 {t('reportsPageTitle')}
          </Link>
        )}
      </nav>

      {!loading && (
        <div>
          {user && <NotificationBell />}
          {user ? (
            <ProfileMenu username={user.username} avatarUrl={user.avatar_url} />
          ) : (
            <Link href="/login" className="sidebar-link">
              <ProfileIcon />
              {t('profile')}
            </Link>
          )}
        </div>
      )}
    </aside>

    {/* Spodní lišta na mobilu - zůstává vždy vidět (kromě chvíle, kdy je
        otevřená boční zásuvka - pak jde za ni). Rychlé přepínání mezi
        nejdůležitějšími místy appky. */}
    <nav className="mobile-bottom-nav">
      <Link href="/" className={`mobile-nav-item ${pathname === '/' ? 'active' : ''}`}>
        <HomeIcon />
        <span>{t('home')}</span>
      </Link>
      <SparksNavButton />
      <button className="mobile-nav-item mobile-nav-create" onClick={() => setCreateMenuOpen(true)}>
        <CreateIcon />
      </button>
      {user && <NotificationBell mobileTrigger />}
      {user ? (
        <Link href="/channel/me" className="mobile-nav-item">
          <span className="mobile-nav-avatar">
            {user.avatar_url ? <img src={user.avatar_url} alt="" /> : <ProfileIcon />}
          </span>
        </Link>
      ) : (
        <Link href="/login" className="mobile-nav-item">
          <ProfileIcon />
        </Link>
      )}
    </nav>

    {createMenuOpen && (
      <div className="mobile-drawer-backdrop" onClick={() => setCreateMenuOpen(false)}>
        <div className="mobile-drawer mobile-drawer-bottom" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-drawer-handle" />
          <Link href="/upload" className="sidebar-link" onClick={() => setCreateMenuOpen(false)}>
            <YourVideosIcon />
            Video
          </Link>
          <Link href="/channel/me?tab=posts&compose=text" className="sidebar-link" onClick={() => setCreateMenuOpen(false)}>
            <CreateIcon />
            Text
          </Link>
          <Link href="/channel/me?tab=posts&compose=photo" className="sidebar-link" onClick={() => setCreateMenuOpen(false)}>
            <DownloadIcon />
            {t('postPhotoTab')}
          </Link>
          <Link href="/channel/me?tab=posts&compose=poll" className="sidebar-link" onClick={() => setCreateMenuOpen(false)}>
            <PlaylistIcon />
            {t('postPollTab')}
          </Link>
        </div>
      </div>
    )}

    {/* Mobilní zásuvka - vidět jen po kliknutí na "⋮" v horní liště (viz TopBar).
        Obsahuje stejné odkazy, ve stejném pořadí, jako běžné menu, jen užší. */}
    {mobileNavOpen && (
      <div className="mobile-drawer-backdrop" onClick={closeMobileNav}>
        <div className="mobile-drawer mobile-drawer-side" onClick={(e) => e.stopPropagation()}>
          <div className="sidebar-logo-row">
            <BrandLogo className="sidebar-logo" onNavigate={closeMobileNav} />
          </div>
          <div className="sidebar-divider" />

          {baseLinks(t).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sidebar-link" onClick={closeMobileNav}>
              <Icon />
              {label}
            </Link>
          ))}

          <button
            className="sidebar-link"
            onClick={() => setExploreOpen((v) => !v)}
            style={{ justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ExploreIcon />
              {t('explore')}
            </span>
            <span style={{ fontSize: 11, transform: exploreOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>▾</span>
          </button>
          {exploreOpen && (
            <div style={{ paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
              {EXPLORE_TABS.map(({ tab, key, icon: Icon }) => (
                <Link key={tab} href={`/explore?tab=${tab}`} className="sidebar-link" onClick={closeMobileNav} style={{ fontSize: 13.5, padding: '8px 14px' }}>
                  <Icon size={15} />
                  {t(key as any)}
                </Link>
              ))}
              {EXPLORE_CATEGORY_KEYS.map((catKey) => (
                <Link key={catKey} href={`/explore?category=${catKey}`} className="sidebar-link" onClick={closeMobileNav} style={{ fontSize: 13.5, padding: '8px 14px' }}>
                  <TagIcon size={15} />
                  {t(catKey as any)}
                </Link>
              ))}
            </div>
          )}

          {user && (
            <>
              <div className="sidebar-divider" />
              {loggedInLinksGroup1(t).map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="sidebar-link" onClick={closeMobileNav}>
                  <Icon />
                  {label}
                </Link>
              ))}
              <div className="sidebar-divider" />
              {loggedInLinksGroup2(t).map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="sidebar-link" onClick={closeMobileNav}>
                  <Icon />
                  {label}
                </Link>
              ))}
            </>
          )}

          <div className="sidebar-divider" />
          <Link href="/upload" className="sidebar-link" onClick={closeMobileNav}>
            <CreateIcon />
            {t('create')}
          </Link>
          {user && (
            <Link href="/donate" className="sidebar-link" onClick={closeMobileNav}>
              💛 {t('donateSidebarLabel')}
            </Link>
          )}
          {isModerator && (
            <Link href="/moderation/reports" className="sidebar-link" onClick={closeMobileNav}>
              🚩 {t('reportsPageTitle')}
            </Link>
          )}

          {!loading && (
            <div style={{ marginTop: 'auto' }}>
              {user && <NotificationBell />}
              {user ? (
                <div className="mobile-drawer-profile">
                  <ProfileMenu username={user.username} avatarUrl={user.avatar_url} />
                </div>
              ) : (
                <Link href="/login" className="sidebar-link" onClick={closeMobileNav}>
                  <ProfileIcon />
                  {t('profile')}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

export function SparkIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="7" height="7" rx="1" />
      <rect x="14" y="5" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" strokeLinecap="round" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 11.5L12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExploreIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-2 6-6 2 2-6 6-2z" strokeLinejoin="round" />
    </svg>
  );
}

function CreateIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="8.5" r="3.3" />
      <path d="M5 20c1-3.2 4-5 7-5s6 1.8 7 5" strokeLinecap="round" />
    </svg>
  );
}

function WatchLaterIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LikedIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" strokeLinejoin="round" />
    </svg>
  );
}

function PlaylistIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6h12M3 12h12M3 18h7" strokeLinecap="round" />
      <path d="M17 10l4 3-4 3v-6z" strokeLinejoin="round" />
    </svg>
  );
}

function YourVideosIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M17 9.5l4-2.5v10l-4-2.5" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SubscribersIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8.5" cy="9" r="3" />
      <circle cx="16" cy="10.5" r="2.3" />
      <path d="M2.5 19c.6-3 3-4.8 6-4.8s5.4 1.8 6 4.8" strokeLinecap="round" />
      <path d="M14.5 14.6c2.3.3 4 1.8 4.5 4.4" strokeLinecap="round" />
    </svg>
  );
}
