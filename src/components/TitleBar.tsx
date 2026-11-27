import { Coffee } from 'lucide-react';
import { openExternalUrl } from '@/lib/externalLink';
'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getCurrentWindow } from '@tauri-apps/api/window';

export const TitleBar: React.FC = () => {
  const pathname = usePathname();
  const [isMaximized, setIsMaximized] = useState(false);

  const routeLabel =
    pathname === '/' ? 'home' : pathname.replace(/^\//, '').toLowerCase();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const appWindow = getCurrentWindow();
      appWindow.isMaximized().then(setIsMaximized).catch(() => {});
      appWindow
        .onResized(async () => {
          try {
            setIsMaximized(await appWindow.isMaximized());
          } catch {}
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    } catch {}

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    try {
      getCurrentWindow().startDragging().catch(() => {});
    } catch {}
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    try {
      getCurrentWindow().toggleMaximize().catch(() => {});
    } catch {}
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className="h-9 min-h-[36px] max-h-[36px] shrink-0 w-full sticky top-0 z-50 flex items-center justify-between border-b border-[var(--term-border)] bg-[var(--term-bg-panel)] font-mono text-xs select-none"
    >
      <div
        data-tauri-drag-region
        className="flex-1 h-full flex items-center gap-2 px-4 min-w-0 cursor-default"
      >
        <span
          data-tauri-drag-region
          className="text-[var(--term-border-bright)] font-semibold pointer-events-none"
        >
          aurora
        </span>
        <span
          data-tauri-drag-region
          className="text-[var(--term-text-dim)] pointer-events-none"
        >
          /
        </span>
        <span
          data-tauri-drag-region
          className="text-[var(--term-text-muted)] lowercase truncate pointer-events-none"
        >
          {routeLabel}
        </span>
      </div>

      <div className="h-full flex items-center gap-1.5 pr-2.5 shrink-0">
        <button
          type="button"
          onClick={() => void openExternalUrl('https://ko-fi.com/m1nem')}
          title="Support on Ko-fi (ko-fi.com/m1nem)"
          aria-label="Support on Ko-fi"
          className="h-6 px-2 rounded-full inline-flex items-center gap-1 bg-transparent text-[var(--term-text-muted)] hover:bg-[var(--term-bg-hover)] hover:text-[var(--term-border-bright)] transition-colors duration-150 text-[10px] font-semibold"
        >
          <Coffee className="w-3 h-3" strokeWidth={2} />
          <span>Ko-fi</span>
        </button>

        <button
          type="button"
          onClick={() => getCurrentWindow().minimize().catch(() => {})}
          title="Minimize"
          aria-label="Minimize"
          className="w-6 h-6 rounded-full inline-flex items-center justify-center bg-transparent text-[var(--term-text-muted)] hover:bg-[var(--term-bg-hover)] hover:text-[var(--term-text-bright)] transition-colors duration-150"
        >
          <svg
            className="w-2.5 h-2.5"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M2.5 6h7" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          className="w-6 h-6 rounded-full inline-flex items-center justify-center bg-transparent text-[var(--term-text-muted)] hover:bg-[var(--term-bg-hover)] hover:text-[var(--term-text-bright)] transition-colors duration-150"
        >
          {isMaximized ? (
            <svg
              className="w-2.5 h-2.5"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3.8" width="6.2" height="6.2" rx="1" />
              <path d="M3.8 3.8V2.7a.7.7 0 0 1 .7-.7h4.8a.7.7 0 0 1 .7.7v4.8a.7.7 0 0 1-.7.7H8.2" />
            </svg>
          ) : (
            <svg
              className="w-2.5 h-2.5"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            >
              <rect x="2.5" y="2.5" width="7" height="7" rx="1.1" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={() => getCurrentWindow().close().catch(() => {})}
          title="Close"
          aria-label="Close"
          className="w-6 h-6 rounded-full inline-flex items-center justify-center bg-transparent text-[var(--term-text-muted)] hover:bg-red-500/25 hover:text-red-400 transition-colors duration-150"
        >
          <svg
            className="w-2.5 h-2.5"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default TitleBar;
