// AURORA_PATCH: Sidebar v6 - Local-first standalone desktop navigation
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSettingsStore } from '@/store/useSettingsStore';
import { themeById } from '@/lib/themes';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', num: '01', label: 'HOME' },
  { href: '/search', num: '02', label: 'SEARCH' },
  { href: '/library', num: '03', label: 'LIBRARY' },
  { href: '/playlists', num: '04', label: 'PLAYLISTS' },
  { href: '/marketplace', num: '05', label: 'MARKETPLACE' },
  { href: '/settings', num: '06', label: 'SETTINGS' },
];

export function Sidebar() {
  const pathname = usePathname();
  const theme = useSettingsStore((s) => s.theme);
  const activeTheme = themeById(theme);

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 select-none sticky top-9 h-[calc(100dvh-2.25rem)] overflow-y-auto pb-[calc(var(--player-height)+1rem)] font-mono text-xs justify-between">
      <div>
        {/* Brand Header */}
        <div className="pb-3 mb-4 border-b border-[var(--term-border)] flex items-center justify-between">
          <span className="font-bold text-sm tracking-wide text-[var(--term-text-bright)]">
            AURORA<span className="text-[var(--term-border-bright)]">_MP</span>
          </span>
          <span className="text-[10px] text-[var(--term-text-dim)]">LOCAL</span>
        </div>

        {/* Clean Navigation */}
        <nav className="flex flex-col space-y-1">
          {navItems.map(({ href, num, label }) => {
            const isActive =
              href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center px-2 py-1.5 transition-none border text-xs',
                  isActive
                    ? 'bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] border-[var(--term-border-bright)] font-semibold'
                    : 'bg-transparent text-[var(--term-text-muted)] border-transparent hover:border-[var(--term-border)] hover:text-[var(--term-text-bright)]'
                )}
              >
                <span className="w-4 select-none font-bold">
                  {isActive ? '>' : ' '}
                </span>
                <span className={isActive ? 'font-semibold' : 'text-[var(--term-text-dim)]'}>
                  {num}
                </span>
                <span className="ml-2 font-medium">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2.5">
        <div className="pt-2 border-t border-[var(--term-border)] flex items-center justify-between gap-2 text-[11px]">
          <span className="text-[var(--term-text-dim)]">Theme:</span>
          <Link
            href="/marketplace?tab=themes"
            className="truncate border border-[var(--term-border)] px-2 py-0.5 text-[10px] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            {activeTheme.name}
          </Link>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px]">
          <Link
            href="/marketplace"
            className="text-[var(--term-text-dim)] hover:text-[var(--term-border-bright)]"
          >
            [ CUSTOMIZE ]
          </Link>
          <Link
            href="/developers"
            className="text-[var(--term-text-dim)] hover:text-[var(--term-border-bright)]"
          >
            [ DEV DOCS ]
          </Link>
        </div>
      </div>
    </aside>
  );
}
