// AURORA_PATCH: AddToPlaylistMenu v3 - Clean CLI aesthetics
'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/usePlayerStore';

interface Props {
  trackId: string;
}

export function AddToPlaylistMenu({ trackId }: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const playlists = usePlayerStore((s) => s.playlists);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleAdd = (playlistId: string) => {
    addTrackToPlaylist(playlistId, trackId);
    setOpen(false);
  };

  const handleCreateAndAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const id = createPlaylist(name);
    addTrackToPlaylist(id, trackId);
    setNewName('');
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className="relative font-mono text-xs select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Add to playlist"
        title="Add to playlist"
        className="px-2 py-1 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] text-xs"
      >
        [ +PL ]
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 border border-[var(--term-border-bright)] bg-[var(--term-bg-panel)] p-2.5 shadow-lg">
          <div className="text-xs font-semibold text-[var(--term-text-bright)] border-b border-[var(--term-border)] pb-1 mb-1.5">
            Add to Playlist
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1">
            {playlists.length === 0 && (
              <p className="text-xs text-[var(--term-text-muted)] py-2">
                No playlists yet.
              </p>
            )}
            {playlists.map((p) => {
              const already = p.trackIds.includes(trackId);
              return (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p.id)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1 text-xs text-[var(--term-text)] hover:bg-[var(--term-bg-hover)] hover:text-[var(--term-text-bright)] text-left border border-transparent hover:border-[var(--term-border)]"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] text-[var(--term-border-bright)]">
                    {already ? '[Added]' : '[+]'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-[var(--term-border)] flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateAndAdd();
              }}
              placeholder="New playlist name..."
              className="flex-1 h-7 px-2 bg-[var(--term-bg-input)] border border-[var(--term-border)] text-xs text-[var(--term-text-bright)] placeholder:text-[var(--term-text-dim)] focus:outline-none focus:border-[var(--term-border-bright)] rounded-none"
            />
            <button
              onClick={handleCreateAndAdd}
              className="h-7 px-2 border border-[var(--term-border-bright)] text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] text-xs font-semibold"
            >
              [+]
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
