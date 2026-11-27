// AURORA_PATCH: Search page v3 - Clean CLI aesthetics
'use client';

import { useState } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { TrackList } from '@/components/TrackList';
import { useSettingsStore } from '@/store/useSettingsStore';
import type { SearchResult } from '@/types';

type SearchMode = 'music' | 'external';

export default function SearchPage() {
  const [mode, setMode] = useState<SearchMode>('music');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const ytdlpEnabled = useSettingsStore((s) => s.plugins.ytdlp);
  const setPlugin = useSettingsStore((s) => s.setPlugin);

  const switchMode = (next: SearchMode) => {
    setMode(next);
    setResults(null);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h1 className="text-base font-bold text-[var(--term-text-bright)]">
          Search
        </h1>
        <p className="text-[var(--term-text-muted)] text-xs mt-1 leading-relaxed">
          YouTube Music search is always available. External search and MP3
          download are an optional integration powered by yt-dlp and disabled by
          default.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--term-border)] pt-3">
          <button
            type="button"
            onClick={() => switchMode('music')}
            className={`border px-3 py-1 font-semibold ${
              mode === 'music'
                ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)]'
                : 'border-[var(--term-border)] text-[var(--term-text-muted)]'
            }`}
          >
            [ MUSIC SEARCH ]
          </button>
          <button
            type="button"
            onClick={() => switchMode('external')}
            className={`border px-3 py-1 font-semibold ${
              mode === 'external'
                ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)]'
                : 'border-[var(--term-border)] text-[var(--term-text-muted)]'
            }`}
          >
            [ EXTERNAL · yt-dlp ]{ytdlpEnabled ? '' : ' (OFF)'}
          </button>
        </div>
      </div>

      {mode === 'external' && !ytdlpEnabled ? (
        <div className="border border-amber-900 bg-amber-950/20 p-4 text-[11px] leading-relaxed text-amber-100">
          <p className="font-semibold text-amber-200">
            YouTube Downloader (yt-dlp) is disabled.
          </p>
          <p className="mt-1 text-amber-100/80">
            This optional external integration requires yt-dlp + ffmpeg and is
            intentionally disabled by default. Enabling it allows on-demand
            external searches and downloads; AuroraMP never downloads content
            without an explicit user action.
          </p>
          <button
            type="button"
            onClick={() => setPlugin('ytdlp', true)}
            className="mt-3 border border-amber-700 px-3 py-1 font-semibold text-amber-200 hover:border-amber-400"
          >
            [ Enable YouTube Downloader Plugin ]
          </button>
        </div>
      ) : (
        <SearchBar key={mode} mode={mode} onResults={setResults} />
      )}

      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <TrackList
          results={results}
          mode="search"
          title={results ? 'Search Results' : 'Results'}
          onClearResults={() => setResults(null)}
        />
      </div>
    </div>
  );
}
