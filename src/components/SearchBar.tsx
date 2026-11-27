'use client';

// AURORA_FIX_SEARCHBAR_YTDLP_V1
import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Button } from './ui/Button';
import { ImportButton } from './ImportButton';
import type { SearchResult } from '@/types';

interface SearchBarProps {
  onResults: (results: SearchResult[]) => void;
  mode?: 'music' | 'external';
}

export function SearchBar({ onResults, mode = 'music' }: SearchBarProps) {
  const external = mode === 'external';
  const ytdlpEnabled = useSettingsStore((s) => s.plugins.ytdlp);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchYouTube = async () => {
    if (!q.trim() || loading) return;
    if (external && !ytdlpEnabled) {
      setError('Enable the YouTube Downloader (yt-dlp) plugin in Marketplace before searching external sources.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (external) {
        params.set('mode', 'external');
        params.set('external', '1');
      }
      const res = await apiFetch(`/api/search?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      onResults(data.results || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full font-mono text-xs">
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-3 space-y-3">
        {/* Terminal Input */}
        <div className="flex items-center gap-2.5">
          <span className="text-[var(--term-border-bright)] font-bold select-none text-sm">
            &gt;
          </span>
          <div className="flex-1 relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') searchYouTube();
              }}
              placeholder={
                external
                  ? 'Search yt-dlp sources (external downloads)...'
                  : 'Search tracks and artists on YouTube Music...'
              }
              className="w-full h-9 px-3 bg-[var(--term-bg-input)] border border-[var(--term-border)] text-sm text-[var(--term-text-bright)] placeholder:text-[var(--term-text-muted)] focus:outline-none focus:border-[var(--term-border-bright)] rounded-none"
            />
          </div>
        </div>

        {external && (
          <p className="text-[11px] leading-relaxed text-[var(--term-text-muted)]">
            External source mode: queries youtube.com via yt-dlp on demand. Nothing is downloaded until you explicitly click [ Download ].
          </p>
        )}

        {/* Action Button Row */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-[var(--term-border)]">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={searchYouTube}
              disabled={loading || !q.trim()}
              size="md"
              variant="primary"
            >
              {loading
                ? '[ Searching... ]'
                : external
                  ? '[ Search yt-dlp ]'
                  : '[ Search YouTube Music ]'}
            </Button>
            {q && (
              <Button
                onClick={() => setQ('')}
                size="md"
                variant="ghost"
              >
                [ Clear ]
              </Button>
            )}
          </div>

          <ImportButton />
        </div>
      </div>

      {error && (
        <div className="mt-2 p-2.5 border border-red-800 bg-red-950/40 text-red-300 text-xs">
          <span className="font-bold text-red-400">Error:</span> {error}
        </div>
      )}
    </div>
  );
}
