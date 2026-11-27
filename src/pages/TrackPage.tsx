import { Play } from 'lucide-react';
// AURORA_PATCH: Track Detail Page - Destination for Discord RPC "Show Track" button
'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useJamStore } from '@/store/useJamStore';
import { useSettingsStore } from '@/store/useSettingsStore';
// AURORA_FIX_TRACKPAGE_DUR_V1
import { isUsableDuration } from '@/lib/audioDuration';
import { formatTime } from '@/lib/utils';
import { useState } from 'react';

export default function TrackDetailPage() {
  const params = useParams();
  const router = useRouter();
  const trackId = params?.id as string;

  const tracks = usePlayerStore((s) => s.tracks);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);

  const createJam = useJamStore((s) => s.createJam);
  const [copied, setCopied] = useState(false);

  // Find track from library or fallback to currently playing track if matching
  const track =
    tracks.find((t) => t.id === trackId) ||
    (currentTrack?.id === trackId ? currentTrack : null);

  const handlePlay = () => {
    if (track) {
      setCurrentTrack(track);
    }
  };

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-5 font-mono text-xs max-w-2xl">
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <div className="text-[10px] text-[var(--term-text-muted)] uppercase tracking-wider mb-1">
          Track Details
        </div>
        <h1 className="text-base font-bold text-[var(--term-text-bright)]">
          {track ? track.title : `Track: ${decodeURIComponent(trackId || 'unknown')}`}
        </h1>
        <p className="text-xs text-[var(--term-text-muted)] mt-0.5">
          {track ? track.author : 'External Discord Activity Reference'}
        </p>
      </div>

      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-4">
        <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
          {/* Thumbnail / Waveform */}
          <div className="h-24 w-24 border border-[var(--term-border)] bg-[var(--term-bg-input)] shrink-0 overflow-hidden flex items-center justify-center">
            {track?.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.thumbnail}
                alt=""
                className="h-full w-full object-cover grayscale"
              />
            ) : (
              <span className="text-2xl text-[var(--term-text-dim)] font-bold">♪</span>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="flex justify-between border-b border-[var(--term-border)] pb-1">
              <span className="text-[var(--term-text-muted)]">Track ID:</span>
              <span className="text-[var(--term-text-bright)] font-semibold truncate max-w-[200px]">
                {trackId}
              </span>
            </div>

            <div className="flex justify-between border-b border-[var(--term-border)] pb-1">
              <span className="text-[var(--term-text-muted)]">Duration:</span>
              <span className="text-[var(--term-text-bright)]">
                {isUsableDuration(track?.duration) ? formatTime(track.duration) : '--:--'}
              </span>
            </div>

            <div className="flex justify-between border-b border-[var(--term-border)] pb-1">
              <span className="text-[var(--term-text-muted)]">Source:</span>
              <span className="text-[var(--term-border-bright)] font-semibold uppercase">
                {track?.source || 'stream'}
              </span>
            </div>

            <div className="flex justify-between border-b border-[var(--term-border)] pb-1">
              <span className="text-[var(--term-text-muted)]">Listen Along:</span>
              <span
                className={
                  false ? 'text-red-300'
                    : 'text-[var(--term-text-dim)]'
                }
              >
                'Disabled'
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex items-center gap-2 flex-wrap">
          <button
            onClick={handlePlay}
            disabled={!track}
            className="px-4 py-2 border border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] font-semibold text-xs hover:opacity-90 disabled:opacity-40"
          >
            [ <Play className="w-3 h-3 inline fill-current align-[-1px] mr-1" />Play Track in AuroraMP ]
          </button>


          <button
            onClick={handleCopyLink}
            className="px-3 py-2 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-white text-xs"
          >
            {copied ? '[ Copied! ]' : '[ Copy Share Link ]'}
          </button>
        </div>

        {!track && (
          <div className="p-3 border border-amber-900 bg-amber-950/30 text-amber-300 text-xs mt-3">
            Note: This track was opened from a Discord presence link. If it is not in your current local session, you can search for it using YouTube Search.
          </div>
        )}
      </div>
    </div>
  );
}
