'use client';

// AURORA_PATCH: toast host v1
import { useToastStore } from '@/store/useToastStore';

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 z-[90] flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 font-mono"
      style={{ bottom: 'calc(var(--player-height) + 1rem)' }}
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-2 border border-[var(--term-border-bright)] bg-[var(--term-bg-panel)] p-3 text-[11px] leading-relaxed text-[var(--term-text-bright)]"
        >
          <span className="shrink-0 text-[var(--term-border-bright)]">
            [ AURORA ]
          </span>
          <span className="min-w-0 flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
            className="shrink-0 border border-[var(--term-border)] px-1 text-[10px] text-[var(--term-text-dim)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
