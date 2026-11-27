// AURORA_PATCH: Home page v3 - Clean CLI aesthetics
'use client';

import Link from 'next/link';
import { usePlayerStore } from '@/store/usePlayerStore';
import { TrackList } from '@/components/TrackList';

export default function HomePage() {
  const tracks = usePlayerStore((s) => s.tracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const recent = tracks.slice(-5).reverse();

  const cards = [
    {
      href: '/search',
      code: '01',
      title: 'Search YouTube',
      desc: 'Query YouTube stream & download MP3s',
      tag: 'STREAM',
    },
    {
      href: '/library',
      code: '02',
      title: 'Local Library',
      desc: `${tracks.length} track${tracks.length === 1 ? '' : 's'} registered in local database`,
      tag: 'LIBRARY',
    },
    {
      href: '/playlists',
      code: '03',
      title: 'Playlists',
      desc: `${playlists.length} curated collection${playlists.length === 1 ? '' : 's'}`,
      tag: 'PLAYLISTS',
    },
    {
      href: '/settings',
      code: '04',
      title: 'Settings',
      desc: 'Theme selector, Discord RPC daemon & audio engine',
      tag: 'CONFIG',
    },
  ];

  return (
    <div className="space-y-6 font-mono text-xs">
      {/* Header Banner */}
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h1 className="text-base font-bold text-[var(--term-text-bright)] tracking-wide">
          AuroraMP <span className="text-[var(--term-border-bright)] font-normal">// Audio Terminal</span>
        </h1>
        <p className="text-[var(--term-text-muted)] text-xs mt-1.5 leading-relaxed max-w-2xl">
          High-contrast command-line audio player. Query online streams, index local MP3s, curate playlist sets, and inspect synchronized lyrics.
        </p>
      </div>

      {/* Action Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(({ href, code, title, desc, tag }) => (
          <Link
            key={href}
            href={href}
            className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 flex flex-col justify-between hover:border-[var(--term-border-bright)] hover:bg-[var(--term-bg-hover)] transition-none group select-none cursor-pointer"
          >
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[var(--term-border-bright)] font-bold text-xs">
                  {code}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 border border-[var(--term-border)] text-[var(--term-text-dim)] group-hover:text-[var(--term-text-bright)]">
                  {tag}
                </span>
              </div>
              <div className="font-semibold text-sm text-[var(--term-text-bright)] group-hover:text-[var(--term-border-bright)]">
                {title}
              </div>
              <p className="text-xs text-[var(--term-text-muted)] mt-2 leading-relaxed">
                {desc}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Recently Added Section */}
      {recent.length > 0 && (
        <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
          <TrackList
            results={null}
            mode="library"
            title="Recently Added Tracks"
          />
        </div>
      )}
    </div>
  );
}
