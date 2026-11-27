// AURORA_PATCH: recover orphaned local MP3s into the current library v2
'use client';

import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { Playlist, Track } from '@/types';

export function RecoverButton() {
  const user = useAuthStore((s) => s.user);
  const mergeLibrary = usePlayerStore((s) => s.mergeLibrary);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const recover = async () => {
    if (!user || busy) return;
    setBusy(true);
    setStatus('Scanning the AuroraMP media directory...');

    try {
      const res = await apiFetch('/api/library/recover', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Recovery failed (HTTP ${res.status})`);
      }

      const tracks = Array.isArray(data.tracks) ? (data.tracks as Track[]) : [];
      const playlists = Array.isArray(data.playlists)
        ? (data.playlists as Playlist[])
        : [];

      mergeLibrary(tracks, playlists, user.id);
      setStatus(
        data.added > 0
          ? `Recovered ${data.added} file(s). Library now has ${tracks.length} track(s).`
          : 'No new audio files found. Everything is already indexed.'
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={recover}
        disabled={!user || busy}
        title={
          user
            ? 'Scan local media folders for MP3s that are not in your library yet'
            : 'Sign in to recover files into an account'
        }
        className="px-3 py-1.5 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] text-xs disabled:opacity-40"
      >
        {busy ? '[ Scanning... ]' : '[ Recover MP3s ]'}
      </button>
      {status && (
        <span className="text-[10px] text-[var(--term-text-dim)] max-w-[260px] text-right leading-relaxed">
          {status}
        </span>
      )}
    </div>
  );
}
