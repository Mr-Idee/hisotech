import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'topbar' | 'workspace';
}

export function PWAInstallButton({ variant = 'topbar' }: PWAInstallButtonProps) {
  const { canNativePrompt, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Per user requirement: completely invisible once installed or running in standalone mode
  if (isInstalled) {
    return null;
  }

  async function handleClick() {
    if (canNativePrompt) {
      await install();
      return;
    }
    setShowGuide(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        data-testid="pwa-install-btn"
        className={
          variant === 'workspace'
            ? 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20'
            : 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#081E3E] transition-colors hover:border-[#D61F26] hover:text-[#D61F26] dark:border-slate-700 dark:bg-[#0B1D39] dark:text-slate-100'
        }
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span>Install App</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install HI-SOTECH App"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-[#0B1D39]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <img src="/pwa-192x192.png" alt="HI-SOTECH" className="h-10 w-10 rounded-lg border border-slate-200" />
                <div>
                  <h3 className="text-base font-bold text-[#081E3E] dark:text-white">Install HI-SOTECH Solar App</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Offline Load Estimator &amp; Operations Workspace
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close install instructions"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-[#061327] dark:text-slate-300">
              {isIOS ? (
                <>
                  <p className="font-semibold text-[#081E3E] dark:text-white">On iPhone / iPad (Safari):</p>
                  <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
                    <li>Tap the <strong>Share</strong> icon in your Safari toolbar.</li>
                    <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
                    <li>Launch HI-SOTECH from your home screen—the Install App button hides automatically inside the installed app.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="font-semibold text-[#081E3E] dark:text-white">On Chrome, Edge, or Android:</p>
                  <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
                    <li>Open your browser menu or click the <strong>Install</strong> icon in the address bar.</li>
                    <li>Confirm <strong>Install HI-SOTECH Solar Platform</strong>.</li>
                    <li>Run offline load calculations anytime; once launched in standalone mode, this install button disappears automatically.</li>
                  </ol>
                </>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Smartphone className="h-3.5 w-3.5 text-[#D61F26]" />
                Works offline for Load Estimator
              </span>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-[#081E3E] px-3.5 py-2 text-xs font-semibold text-white shadow-lg ring-1 ring-white/20"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-400" />
      <span>Offline Mode — Local Load Estimator &amp; Cached Storefront Ready</span>
    </div>
  );
}
