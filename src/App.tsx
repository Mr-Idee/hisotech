import { useEffect, useState } from 'react';
import { CustomerProfileView } from './components/CustomerProfileView';
import { DocumentView } from './components/DocumentView';
import { EstimatorView } from './components/EstimatorView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { PublicSite } from './components/PublicSite';
import { StorefrontView } from './components/StorefrontView';
import { TopBar, type AppRoute } from './components/TopBar';
import { TrackerView } from './components/TrackerView';
import { WorkspaceView } from './components/WorkspaceView';
import { api } from './lib/api';
import type { ApplianceItem, CatalogItem } from './lib/types';

const CACHED_CATALOG_KEY = 'hiso_cached_catalog';
const THEME_MODE_KEY = 'hiso_theme_mode';
type ThemeMode = 'system' | 'light' | 'dark';

function readThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_MODE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function readRouteFromHash(): AppRoute {
  const hash = window.location.hash.replace(/^#/, '').split('?')[0];
  if (
    hash === 'store' ||
    hash === 'estimator' ||
    hash === 'customer' ||
    hash === 'track' ||
    hash === 'workspace'
  ) {
    return hash;
  }
  return 'home';
}

function readCachedCatalog(): CatalogItem[] {
  try {
    const raw = window.localStorage.getItem(CACHED_CATALOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => readRouteFromHash());
  const [trackRef, setTrackRef] = useState<string | undefined>(undefined);
  const [docView, setDocView] = useState<{ type: 'quote' | 'invoice'; id: string } | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>(() => readCachedCatalog());
  const [importedAppliances, setImportedAppliances] = useState<ApplianceItem[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [systemDarkMode, setSystemDarkMode] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );
  const darkMode = themeMode === 'dark' || (themeMode === 'system' && systemDarkMode);

  function saveAndSetCatalog(nextCatalog: CatalogItem[]) {
    setCatalog(nextCatalog);
    try {
      window.localStorage.setItem(CACHED_CATALOG_KEY, JSON.stringify(nextCatalog));
    } catch {
      // Ignore storage quota errors
    }
  }

  useEffect(() => {
    api
      .getPublicBootstrap()
      .then((res) => {
        saveAndSetCatalog(res.catalog);
      })
      .catch(() => {
        // Offline mode: fallback cleanly to cached catalog from localStorage
      });

    const onHashChange = () => setRoute(readRouteFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const syncSystemTheme = (event: MediaQueryListEvent) => setSystemDarkMode(event.matches);
    setSystemDarkMode(media.matches);
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  function cycleThemeMode() {
    const nextMode: ThemeMode = themeMode === 'system'
      ? 'light'
      : themeMode === 'light'
        ? 'dark'
        : 'system';
    setThemeMode(nextMode);
    try {
      window.localStorage.setItem(THEME_MODE_KEY, nextMode);
    } catch {
      // Theme selection still applies for this session when storage is unavailable.
    }
  }

  function handleNavigate(next: AppRoute, sectionId?: string) {
    setDocView(null);
    setRoute(next);
    const targetHash = `#${sectionId || next}`;
    if (window.location.hash !== targetHash) {
      window.history.pushState(null, '', targetHash);
    }
    if (sectionId) {
      setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleUseStoreItemInEstimator(item: CatalogItem) {
    if (item.itemType === 'appliance') {
      setImportedAppliances([
        {
          id: `store-${item.sku}-${Date.now()}`,
          name: item.name,
          qty: 1,
          watts: item.watts ?? 150,
          hours: 6,
          catalogSku: item.sku,
        },
      ]);
    }
    handleNavigate('estimator');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#061327] dark:text-slate-100">
      <TopBar
        activeRoute={route}
        onNavigate={handleNavigate}
        darkMode={darkMode}
        themeMode={themeMode}
        onToggleTheme={cycleThemeMode}
      />

      {docView ? (
        <DocumentView
          type={docView.type}
          id={docView.id}
          onBack={() => setDocView(null)}
        />
      ) : route === 'home' ? (
        <PublicSite
          catalog={catalog}
          darkMode={darkMode}
          themeMode={themeMode}
          onToggleTheme={cycleThemeMode}
          onNavigate={handleNavigate}
        />
      ) : route === 'store' ? (
        <StorefrontView
          catalog={catalog}
          onUseInEstimator={handleUseStoreItemInEstimator}
          onOpenEstimator={() => handleNavigate('estimator')}
          onTrackOrder={(refCode) => {
            setTrackRef(refCode);
            handleNavigate('track');
          }}
        />
      ) : route === 'estimator' ? (
        <EstimatorView
          catalog={catalog}
          importedAppliances={importedAppliances}
          onClearImported={() => setImportedAppliances([])}
          onOpenStorefront={() => handleNavigate('store')}
          onTrackRef={(refCode) => {
            setTrackRef(refCode);
            handleNavigate('track');
          }}
        />
      ) : route === 'customer' ? (
        <CustomerProfileView />
      ) : route === 'track' ? (
        <TrackerView
          initialRef={trackRef}
          onOpenDocument={(type, id) => setDocView({ type, id })}
        />
      ) : (
        <WorkspaceView
          onOpenDocument={(type, id) => setDocView({ type, id })}
          onCatalogChange={saveAndSetCatalog}
        />
      )}

      <OfflineIndicator />
    </div>
  );
}
