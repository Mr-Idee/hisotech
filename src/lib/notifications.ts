export type AppNoticeKind = 'success' | 'error';

export function notifyUser(message: string, kind: AppNoticeKind = 'success'): void {
  if (!message.trim() || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('hiso:notice', { detail: { message, kind } }));
}
