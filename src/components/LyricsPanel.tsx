// AURORA_PATCH: LyricsPanel v4 - provider selection + synchronized LRC
'use client';

import { useEffect } from 'react';
import { LyricsView } from './LyricsView';
import { usePlayerStore } from '@/store/usePlayerStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LyricsPanel({ open, onClose }: Props) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'q') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/70 cursor-pointer"
      />
      <aside className="fixed right-0 top-0 bottom-0 z-[61] flex w-full max-w-[520px] flex-col border-l border-[var(--term-border)] bg-[var(--term-bg-panel)] p-3 font-mono text-xs">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--term-border)] pb-2.5">
          <div className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-[var(--term-text-muted)]">
              Lyrics Viewer
            </span>
            <h2 className="truncate text-sm font-semibold text-[var(--term-text-bright)]">
              {currentTrack?.title ?? 'No track'}
            </h2>
            <p className="truncate text-[11px] text-[var(--term-text-muted)]">
              {currentTrack?.author ?? ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 border border-[var(--term-border)] px-2.5 py-1 text-xs text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            [ Close ]
          </button>
        </header>

        <LyricsView className="mt-2 min-h-0 flex-1" />
      </aside>
    </>
  );
}
