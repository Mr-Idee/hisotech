import { useEffect, useState } from 'react';
import { api } from '../lib/api';

function decodeVapidKey(value: string): Uint8Array {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function PushSubscriptionControl() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [mobileGuidance, setMobileGuidance] = useState('');

  useEffect(() => {
    const userAgent = navigator.userAgent;
    const appleMobile = /iPhone|iPad|iPod/i.test(userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setMobileGuidance(appleMobile
      ? 'On iPhone or iPad, add HI-SOTECH to the Home Screen, open the installed app, then enable notifications. Web Push requires iOS/iPadOS 16.4 or later.'
      : /Android/i.test(userAgent)
        ? 'On Android, use Chrome (or another Web Push-capable browser), allow notifications, and keep this app installed or open in that browser.'
        : '');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('This browser does not support Web Push notifications.');
      return;
    }
    void navigator.serviceWorker.ready.then(async (registration) => {
      const current = await registration.pushManager.getSubscription();
      if (current) setSubscription(current);
    }).catch(() => setError('Could not load the app notification worker. Reload the installed app and try again.'));
  }, []);

  async function subscribe() {
    setBusy(true);
    setStatus('');
    setError('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('This browser does not support Web Push notifications.');
      }
      if (!window.isSecureContext) {
        throw new Error('Web Push requires HTTPS (localhost is supported for local testing).');
      }
      const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (appleMobile && !isStandalone) {
        throw new Error('On iPhone or iPad, first use Safari’s Share menu to add HI-SOTECH to the Home Screen, then open the installed app. Web Push requires iOS/iPadOS 16.4 or later.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notifications are blocked for this app in browser or device settings. Allow them there, then try again.'
          : 'Notification permission was not granted.');
      }
      const { publicKey } = await api.getPushConfig();
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = decodeVapidKey(publicKey).buffer as ArrayBuffer;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      await api.savePushSubscription(subscription.toJSON());
      setSubscription(subscription);
      setStatus('This device is subscribed to HI-SOTECH notifications.');
    } catch (err) {
      setError((err as Error).message || 'Could not subscribe this device to notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
      if (!subscription) return;
      setBusy(true);
      setError('');
      setStatus('');
      try {
        await api.deletePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
        setSubscription(null);
        setStatus('This device was unsubscribed from HI-SOTECH notifications.');
      } catch (err) {
        setError((err as Error).message || 'Could not unsubscribe this device.');
      } finally {
        setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-[#0B1D39]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[#081E3E] dark:text-white">Browser notifications</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Opt in on this device to HI-SOTECH service updates and optional news. Unsubscribe here or revoke permission in browser settings.
          </p>
          {mobileGuidance && <p className="mt-2 max-w-2xl text-xs text-slate-600 dark:text-slate-300">{mobileGuidance}</p>}
        </div>
        <button type="button" onClick={subscription ? unsubscribe : subscribe} disabled={busy}
          className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] disabled:opacity-60">
          {busy ? 'Working…' : subscription ? 'Unsubscribe this device' : 'Enable notifications'}
        </button>
      </div>
      {status && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300" role="status">{status}</p>}
      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>}
    </div>
  );
}
