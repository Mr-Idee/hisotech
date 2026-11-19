import { Menu, Moon, Sun, Monitor, X } from 'lucide-react';
import { useState } from 'react';
import { PWAInstallButton } from './PWAInstallButton';

export type AppRoute = 'home' | 'store' | 'estimator' | 'customer' | 'track' | 'workspace';

interface TopBarProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute, sectionId?: string) => void;
  darkMode: boolean;
  themeMode: 'system' | 'light' | 'dark';
  onToggleTheme: () => void;
}

export function TopBar({ activeRoute, onNavigate, darkMode, themeMode, onToggleTheme }: TopBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: { label: string; route: AppRoute; section?: string }[] = [
    { label: 'Home', route: 'home' },
    { label: 'Load Estimator', route: 'estimator' },
    { label: 'Customer Portal', route: 'customer' },
    { label: 'Store', route: 'store' },
    { label: 'Track Request', route: 'track' },
  ];

  const ThemeIcon = themeMode === 'system' ? Monitor : darkMode ? Moon : Sun;

  const handleNav = (route: AppRoute, section?: string) => {
    setMobileOpen(false);
    onNavigate(route, section);
  };

  return (
    <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-[#061327]/95">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            handleNav('home');
          }}
          className="flex shrink-0 items-center gap-2.5 text-lg font-bold tracking-tight text-[#081E3E] whitespace-nowrap dark:text-white"
        >
          <img
            src="/assets/hisotech-logo-mark.png"
            alt="HI-SOTECH"
            className="h-8 w-8 object-contain"
            referrerPolicy="no-referrer"
          />
          <span className="font-display">HI-SOTECH</span>
        </a>

        {/* Zone 2: Concise single-line navigation */}
        <nav aria-label="Primary navigation" className="hidden items-center gap-4 lg:flex">
          {navItems.map((item) => {
            const isCurrent = activeRoute === item.route && !item.section;
            return (
              <a
                key={item.label}
                href={`#${item.section || item.route}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleNav(item.route, item.section);
                }}
                className={`whitespace-nowrap shrink-0 text-sm font-medium transition-colors hover:text-[#D61F26] ${
                  isCurrent
                    ? 'text-[#D61F26] underline decoration-2 underline-offset-8'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: Install App (hidden when installed) + Primary Staff Workspace Action */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`Theme: ${themeMode}. Change theme`}
            title={`Theme: ${themeMode}`}
            className="hidden h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:inline-flex dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ThemeIcon className="h-4 w-4" />
            <span className="capitalize">{themeMode}</span>
          </button>
          <div className="hidden sm:block">
            <PWAInstallButton variant="topbar" />
          </div>
          <button
            type="button"
            onClick={() => handleNav('workspace')}
            className="hidden whitespace-nowrap shrink-0 rounded-lg bg-[#081E3E] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#D61F26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D61F26] lg:inline-flex dark:bg-[#D61F26] dark:hover:bg-[#B0171D]"
          >
            Staff Workspace
          </button>

          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 lg:hidden dark:border-slate-700 dark:text-slate-200"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden dark:border-slate-800 dark:bg-[#081E3E]">
          <div className="flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleNav(item.route, item.section)}
                className="flex min-h-[44px] items-center rounded-lg px-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                {item.label}
              </button>
            ))}
            <div className="my-1 grid grid-cols-3 gap-1 border-y border-slate-100 py-2 dark:border-slate-800">
              {[
                { label: 'About', sec: 'about' },
                { label: 'Services', sec: 'services' },
                { label: 'Projects', sec: 'projects' },
                { label: 'Pricing', sec: 'pricing' },
                { label: 'Contact', sec: 'contact' },
              ].map((anchor) => (
                <button
                  key={anchor.sec}
                  type="button"
                  onClick={() => handleNav('home', anchor.sec)}
                  className="min-h-[40px] rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {anchor.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={`Theme: ${themeMode}. Change theme`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <ThemeIcon className="h-4 w-4" />
                <span className="capitalize">{themeMode}</span>
              </button>
              <PWAInstallButton variant="topbar" />
              <button
                type="button"
                onClick={() => handleNav('workspace')}
                className="inline-flex min-h-[44px] w-fit shrink-0 items-center justify-center rounded-lg bg-[#D61F26] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#B0171D]"
              >
                Staff Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
