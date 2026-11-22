import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppNoticeKind } from '../lib/notifications';

interface Notice {
  id: number;
  message: string;
  kind: AppNoticeKind;
}

export function GlobalNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const showNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown; kind?: unknown }>).detail;
      if (typeof detail?.message !== 'string' || !detail.message.trim()) return;
      setNotice({
        id: Date.now(),
        message: detail.message,
        kind: detail.kind === 'error' ? 'error' : 'success',
      });
    };
    window.addEventListener('hiso:notice', showNotice);
    return () => window.removeEventListener('hiso:notice', showNotice);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  const isError = notice.kind === 'error';
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex justify-center sm:inset-x-auto sm:right-6 sm:w-[min(28rem,calc(100vw-3rem))]">
      <div
        key={notice.id}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-4 shadow-xl animate-notice-in ${
          isError
            ? 'border-red-200 bg-white text-red-900 dark:border-red-800 dark:bg-[#251117] dark:text-red-100'
            : 'border-emerald-200 bg-white text-emerald-950 dark:border-emerald-800 dark:bg-[#0D241F] dark:text-emerald-100'
        }`}
      >
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isError ? 'text-red-600' : 'text-emerald-600'}`} />
        <p className="min-w-0 flex-1 text-sm font-medium">{notice.message}</p>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => setNotice(null)}
          className="rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
