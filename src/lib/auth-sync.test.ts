import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listenForCustomerLogout,
  listenForStaffLogout,
  notifyCustomerLogoutAcrossTabs,
  notifyStaffLogoutAcrossTabs,
} from './auth-sync';

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.channels.add(this);
  }

  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel.name === this.name && channel !== this) {
        channel.onmessage?.({ data } as MessageEvent<unknown>);
      }
    }
  }

  close() {
    FakeBroadcastChannel.channels.delete(this);
  }
}

test('logout notifications reach matching tabs without crossing staff/customer sessions', () => {
  const originalWindow = globalThis.window;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const fakeWindow = {
    localStorage: { setItem: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: FakeBroadcastChannel });

  try {
    let staffLogouts = 0;
    let customerLogouts = 0;
    const stopStaff = listenForStaffLogout(() => { staffLogouts += 1; });
    const stopCustomer = listenForCustomerLogout(() => { customerLogouts += 1; });

    assert.equal(notifyStaffLogoutAcrossTabs(), true);
    assert.equal(staffLogouts, 1);
    assert.equal(customerLogouts, 0);

    assert.equal(notifyCustomerLogoutAcrossTabs(), true);
    assert.equal(staffLogouts, 1);
    assert.equal(customerLogouts, 1);

    stopStaff();
    stopCustomer();
  } finally {
    FakeBroadcastChannel.channels.clear();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: originalBroadcastChannel });
  }
});
