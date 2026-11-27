import { Play, Pause } from 'lucide-react';
// AURORA_PATCH: TrackList v3 - Clean CLI aesthetics
'use client';

import { apiFetch } from '@/lib/api';
import { useMemo, useState } from 'react';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
// AURORA_FIX_TRACKLIST_DUR_V1
import { isUsableDuration } from '@/lib/audioDuration';
import { formatTime, cn } from '@/lib/utils';
import type { SearchResult, Track } from '@/types';

interface TrackListProps {
  results: SearchResult[] | null;
  title?: string;
  mode: 'search' | 'library';
  onClearResults?: () => void;
  allowRemove?: boolean;
}

export function TrackList({
  results,
  title,
  mode,
  onClearResults,
  allowRemove = false,
}: TrackListProps) {
  const tracks = usePlayerStore((s) => s.tracks);
  const addTrack = usePlayerStore((s) => s.addTrack);
  const updateTrack = usePlayerStore((s) => s.updateTrack);
  const removeTrack = usePlayerStore((s) => s.removeTrack);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const ytdlpEnabled = useSettingsStore((s) => s.plugins.ytdlp);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const list = useMemo(() => {
    if (mode === 'search') return results ?? [];
    const f = filter.trim().toLowerCase();
    if (!f) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(f) ||
        t.author.toLowerCase().includes(f)
    );
  }, [mode, results, tracks, filter]);

  const downloadAndPlay = async (r: SearchResult) => {
    if (!ytdlpEnabled) {
      setNotice(
        'Enable the YouTube Downloader (yt-dlp) plugin in Marketplace to download external audio.'
      );
      return;
    }
    if (downloading) return;
    setDownloading(r.id);
    try {
      const params = new URLSearchParams({
        id: r.id,
        title: r.title,
        author: r.author,
        duration: String(r.duration ?? 0),
        thumbnail: r.thumbnail ?? '',
      });
      if (r.album) params.set('album', r.album);
      params.set('external', '1');
      const res = await apiFetch(`/api/download?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download failed');

      const track: Track = data.track ?? {
        id: r.id,
        title: r.title,
        author: r.author,
        album: r.album,
        duration: r.duration,
        thumbnail: r.thumbnail,
        url: data.url,
        source: 'youtube',
      };
      if (tracks.some((t) => t.id === track.id)) {
        updateTrack(track.id, track);
      } else {
        addTrack(track);
      }
      setCurrentTrack(track);
    } catch (e) {
      setNotice(
        `Download failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setDownloading(null);
    }
  };

  // Empty state for search mode
  if (mode === 'search' && (!results || results.length === 0)) {
    return (
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-5 font-mono text-xs">
        <p className="text-[var(--term-text-bright)] font-semibold text-sm">
          No tracks found. Type to search or import.
        </p>
        <p className="mt-2 text-[var(--term-text-muted)] text-xs">
          Search YouTube online or import local MP3 files to start playback.
        </p>
      </div>
    );
  }

  return (
    <div className="font-mono text-xs space-y-3">
      {/* Table Header Section */}
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-[var(--term-border)] pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[var(--term-text-bright)] font-semibold text-sm">
            {title ?? (mode === 'search' ? 'Search Results' : 'Music Library')}
          </span>
          <span className="text-[11px] text-[var(--term-text-muted)]">
            ({list.length} {list.length === 1 ? 'track' : 'tracks'})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'library' && tracks.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--term-text-muted)]">Filter:</span>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Title or artist..."
                className="bg-[var(--term-bg-input)] border border-[var(--term-border)] h-7 px-2.5 text-xs text-[var(--term-text-bright)] placeholder:text-[var(--term-text-dim)] focus:outline-none focus:border-[var(--term-border-bright)] rounded-none"
              />
            </div>
          )}

          {mode === 'search' && onClearResults && (
            <button
              onClick={onClearResults}
              className="px-2.5 py-1 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] text-xs"
            >
              [ Clear ]
            </button>
          )}
        </div>
      </div>

      {/* Row items */}
      <div className="space-y-1">
        {notice && (
          <div className="border border-amber-900 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200 flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-amber-300 hover:text-amber-100"
            >
              [ Dismiss ]
            </button>
          </div>
        )}
        {list.map((item, i) => {
          const isSearch = mode === 'search';
          const track = item as Track;
          const sr = item as SearchResult;
          const isImported = !isSearch && track.source === 'imported';

          const id = isSearch ? sr.id : track.id;
          const thumbnail = isSearch ? sr.thumbnail : track.thumbnail;
          const displayTitle = isSearch ? sr.title : track.title;
          const author = isSearch ? sr.author : track.author;
          const duration = isSearch ? sr.duration : track.duration;

          const isCurrent = currentTrack?.id === id;
          const isLoading = downloading === id;
          const indexNum = String(i + 1).padStart(2, '0');

          return (
            <div
              key={`${mode}-${id}`}
              onClick={() => {
                if (isSearch) {
                  return;
                } else if (isImported) {
                  setNotice(
                    `"${track.title}" is imported Spotify metadata and has no audio source yet. Search YouTube to add a playable version.`
                  );
                } else {
                  setCurrentTrack(track);
                }
              }}
              className={cn(
                'group border p-2.5 flex items-center gap-3 select-none transition-none',
                isImported ? 'cursor-default' : 'cursor-pointer',
                isCurrent
                  ? 'border-[var(--term-border-bright)] bg-[var(--term-bg-hover)]'
                  : 'border-[var(--term-border)] bg-[var(--term-bg-panel)] hover:bg-[var(--term-bg-hover)] hover:border-[var(--term-text-muted)]'
              )}
            >
              {/* Index Indicator */}
              <div className="w-8 shrink-0 text-xs font-semibold">
                {isCurrent ? (
                  <span className="text-[var(--term-border-bright)] font-bold">
                    <span className="inline-flex items-center gap-1">{isPlaying ? <Play className="w-3 h-3 inline fill-current" /> : <Pause className="w-3 h-3 inline fill-current" />}{indexNum}</span>
                  </span>
                ) : (
                  <span className="text-[var(--term-text-dim)]">{indexNum}</span>
                )}
              </div>

              {/* Thumbnail */}
              <div className="relative h-9 w-9 shrink-0 border border-[var(--term-border)] bg-[var(--term-bg-input)] overflow-hidden">
                {thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnail}
                    alt=""
                    className="h-full w-full object-cover grayscale"
                  />
                ) : (
                  <div className="h-full w-full grid place-items-center text-[var(--term-text-dim)] font-bold text-xs">
                    ♪
                  </div>
                )}
              </div>

              {/* Title & Artist */}
              <div className="flex-1 min-w-0 pr-2">
                <p className="text-xs font-semibold text-[var(--term-text-bright)] truncate">
                  {displayTitle}
                </p>
                <p className="text-[11px] text-[var(--term-text-muted)] truncate">
                  {author}
                  {!isSearch && track.album ? ` — ${track.album}` : ''}
                </p>
              </div>

              {isImported && (
                <span className="shrink-0 border border-[var(--term-border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--term-text-dim)]">
                  Imported
                </span>
              )}

              {/* Duration */}
              <div className="text-[11px] text-[var(--term-text-muted)] tabular-nums shrink-0 w-14 text-right">
                {isUsableDuration(duration) ? formatTime(duration) : '--:--'}
              </div>

              {/* Actions */}
              <div
                className="flex items-center gap-1.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                {!isSearch && <AddToPlaylistMenu trackId={id} />}

                {isSearch ? (
                  <button
                    onClick={() => downloadAndPlay(sr)}
                    disabled={isLoading}
                    title={
                      ytdlpEnabled
                        ? 'Download this external track into the local library'
                        : 'Enable the optional yt-dlp plugin to download'
                    }
                    className="px-2.5 py-1 border border-[var(--term-border-bright)] text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] transition-none text-xs disabled:opacity-40"
                  >
                    {isLoading
                      ? '[ Downloading... ]'
                      : ytdlpEnabled
                        ? '[ Download ]'
                        : '[ Downloader Off ]'}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (isImported) {
                        setNotice(
                          `"${track.title}" is imported Spotify metadata and has no audio source yet. Search YouTube to add a playable version.`
                        );
                        return;
                      }
                      setCurrentTrack(track);
                    }}
                    disabled={isImported}
                    className="px-2.5 py-1 border border-[var(--term-border)] text-[var(--term-text)] hover:border-[var(--term-border-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] transition-none text-xs disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--term-text)]"
                  >
                    {isImported
                      ? '[ No Audio ]'
                      : isCurrent && isPlaying
                        ? '[ Pause ]'
                        : '[ Play ]'}
                  </button>
                )}

                {allowRemove && !isSearch && (
                  <button
                    onClick={() => removeTrack(id)}
                    aria-label="Remove track"
                    title="Remove from library"
                    className="px-2 py-1 border border-red-900 text-red-400 hover:bg-red-600 hover:text-black transition-none text-xs"
                  >
                    [ Del ]
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty library state */}
      {mode === 'library' && tracks.length === 0 && (
        <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-6 text-center text-xs">
          <p className="text-[var(--term-text-bright)] font-semibold mb-1">
            No tracks found in library.
          </p>
          <p className="text-[var(--term-text-muted)]">
            Import MP3 files from your disk or search YouTube to add music.
          </p>
        </div>
      )}

      {/* Filter matched 0 items */}
      {mode === 'library' &&
        tracks.length > 0 &&
        list.length === 0 &&
        filter.trim() !== '' && (
          <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 text-xs text-[var(--term-text-muted)]">
            No tracks matching &ldquo;{filter}&rdquo;.
          </div>
        )}
    </div>
  );
}
