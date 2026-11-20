type LogoutScope = 'staff' | 'customer';

function notifyLogoutAcrossTabs(scope: LogoutScope): boolean {
  if (typeof window === 'undefined') return false;
  let notified = false;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(`hiso-${scope}-logout`);
      channel.postMessage('logout');
      channel.close();
      notified = true;
    } catch {
      // Fall back to the storage event when BroadcastChannel is unavailable.
    }
  }

  try {
    window.localStorage.setItem(
      `hiso_${scope}_logout_signal`,
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    notified = true;
  } catch {
    // BroadcastChannel remains available when local storage is blocked.
  }

  return notified;
}

function listenForLogout(scope: LogoutScope, callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(`hiso-${scope}-logout`);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === 'logout') callback();
      };
    } catch {
      channel = null;
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === `hiso_${scope}_logout_signal` && event.newValue) callback();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

export function notifyStaffLogoutAcrossTabs(): boolean {
  return notifyLogoutAcrossTabs('staff');
}

export function listenForStaffLogout(callback: () => void): () => void {
  return listenForLogout('staff', callback);
}

export function notifyCustomerLogoutAcrossTabs(): boolean {
  return notifyLogoutAcrossTabs('customer');
}

export function listenForCustomerLogout(callback: () => void): () => void {
  return listenForLogout('customer', callback);
}
