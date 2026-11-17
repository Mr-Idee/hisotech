import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALLED_STORAGE_KEY = 'hiso_pwa_installed';

function checkStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const markedInstalled = window.localStorage?.getItem(INSTALLED_STORAGE_KEY) === '1';
  return displayStandalone || iosStandalone || markedInstalled;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkStandalone());
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setIsInstalled(checkStandalone());

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const mq = window.matchMedia?.('(display-mode: standalone)');
    const handleMediaChange = () => {
      if (checkStandalone()) {
        setIsInstalled(true);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      try {
        window.localStorage.setItem(INSTALLED_STORAGE_KEY, '1');
      } catch {
        // ignore storage restrictions
      }
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    mq?.addEventListener?.('change', handleMediaChange);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mq?.removeEventListener?.('change', handleMediaChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'prompted' | 'manual'> => {
    if (!deferredPrompt) {
      return 'manual';
    }
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      try {
        window.localStorage.setItem(INSTALLED_STORAGE_KEY, '1');
      } catch {
        // ignore
      }
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
    return 'prompted';
  }, [deferredPrompt]);

  return {
    canNativePrompt: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}
