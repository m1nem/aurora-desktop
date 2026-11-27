// AURORA_PATCH: AppShell v6 - Local-first desktop shell
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { Player } from './Player';
import { ThemeInjector } from './ThemeInjector';
import { PluginRuntime } from './PluginRuntime';
import { ToastHost } from './ToastHost';
import { StartupFiles } from './StartupFiles';
import { cn } from '@/lib/utils';

const mobileNav = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Search' },
  { href: '/library', label: 'Library' },
  { href: '/playlists', label: 'Playlists' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col min-h-dvh bg-[var(--term-bg)] text-[var(--term-text)] font-mono selection:bg-[var(--term-selection-bg)] selection:text-[var(--term-selection-text)]">
      <TitleBar />

      <div className="flex flex-1 min-w-0">
        <Sidebar />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile Nav Bar */}
          <nav className="md:hidden border-b border-[var(--term-border)] bg-[var(--term-bg-input)] px-2 py-1.5 flex items-center gap-1 overflow-x-auto text-xs">
            {mobileNav.map(({ href, label }) => {
              const isActive =
                href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'px-2.5 py-1 border whitespace-nowrap text-xs transition-none',
                    isActive
                      ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] font-semibold'
                      : 'border-transparent text-[var(--term-text-muted)] hover:border-[var(--term-border)]'
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Main Workspace */}
          <main className="app-main flex-1 min-w-0 max-w-full overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>

      <Player />
      <ThemeInjector />
      <PluginRuntime />
      <ToastHost />
      <StartupFiles />
    </div>
  );
}
