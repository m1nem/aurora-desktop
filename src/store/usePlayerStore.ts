// AURORA_PATCH: player store v2 - persistent library + account sync helpers
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isUsableDuration } from '@/lib/audioDuration';
import type { Track, Playlist, RepeatMode } from '@/types';

interface PlayerState {
  tracks: Track[];
  playlists: Playlist[];
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  progress: number;
  duration: number;
  // AURORA_FIX_PLAYER_STORE_V1
  shuffle: boolean;
  repeatMode: RepeatMode;
  /** Runtime counter incremented whenever a track is explicitly triggered. */
  playNonce: number;

  /** Account that owns the persisted library. `null` means guest/local. */
  ownerId: string | null;
  /** Changes on every library mutation so sync can resolve conflicts. */
  libraryUpdatedAt: number;

  addTrack: (t: Track) => void;
  addTracks: (t: Track[]) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  setCurrentTrack: (t: Track | null) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  setProgress: (p: number) => void;
  setDuration: (d: number) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;

  createPlaylist: (name: string) => string;
  deletePlaylist: (id: string) => void;
  renamePlaylist: (id: string, name: string) => void;
  addTrackToPlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  clearLibrary: () => void;

  replaceLibrary: (
    tracks: Track[],
    playlists: Playlist[],
    ownerId?: string | null,
    updatedAt?: number
  ) => void;
  mergeLibrary: (
    tracks: Track[],
    playlists: Playlist[],
    ownerId?: string | null
  ) => void;
  setOwnerId: (ownerId: string | null) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      tracks: [],
      playlists: [],
      currentTrack: null,
      isPlaying: false,
      volume: 0.8,
      progress: 0,
      duration: 0,
      shuffle: false,
      repeatMode: 'off',
      playNonce: 0,
      ownerId: null,
      libraryUpdatedAt: 0,

      addTrack: (t) =>
        set((s) => {
          if (s.tracks.some((x) => x.id === t.id)) return s;
          return {
            tracks: [...s.tracks, t],
            libraryUpdatedAt: Date.now(),
          };
        }),

      addTracks: (ts) =>
        set((s) => {
          const existing = new Set(s.tracks.map((x) => x.id));
          const filtered = ts.filter((t) => !existing.has(t.id));
          if (filtered.length === 0) return s;
          return {
            tracks: [...s.tracks, ...filtered],
            libraryUpdatedAt: Date.now(),
          };
        }),

      updateTrack: (id, patch) =>
        set((s) => {
          const index = s.tracks.findIndex((t) => t.id === id);
          if (index === -1) return s;
          const tracks = s.tracks.slice();
          tracks[index] = { ...tracks[index], ...patch };
          return {
            tracks,
            currentTrack:
              s.currentTrack?.id === id
                ? { ...s.currentTrack, ...patch }
                : s.currentTrack,
            libraryUpdatedAt: Date.now(),
          };
        }),

      removeTrack: (id) =>
        set((s) => ({
          tracks: s.tracks.filter((t) => t.id !== id),
          currentTrack: s.currentTrack?.id === id ? null : s.currentTrack,
          playlists: s.playlists.map((p) => ({
            ...p,
            trackIds: p.trackIds.filter((tid) => tid !== id),
          })),
          libraryUpdatedAt: Date.now(),
        })),

      setCurrentTrack: (t) =>
        set((s) => ({
          currentTrack: t,
          isPlaying: !!t && t.source !== 'imported',
          progress: 0,
          duration: isUsableDuration(t?.duration) ? t.duration : 0,
          playNonce: s.playNonce + 1,
        })),

      play: () => set({ isPlaying: true }),
      pause: () => set({ isPlaying: false }),
      togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

      next: () => {
        const { tracks, currentTrack, shuffle } = get();
        const playable = tracks.filter((track) => track.source !== 'imported');
        if (playable.length === 0) {
          set({ currentTrack: null, isPlaying: false, progress: 0, duration: 0 });
          return;
        }
        if (!currentTrack || currentTrack.source === 'imported') {
          const first = playable[0];
          set({
            currentTrack: first,
            isPlaying: true,
            progress: 0,
            duration: isUsableDuration(first.duration) ? first.duration : 0,
          });
          return;
        }
        const idx = playable.findIndex((t) => t.id === currentTrack.id);
        const nextIdx = shuffle
          ? Math.floor(Math.random() * playable.length)
          : (idx + 1) % playable.length;
        const upcoming = playable[nextIdx];
        set({
          currentTrack: upcoming,
          isPlaying: true,
          progress: 0,
          duration: isUsableDuration(upcoming.duration) ? upcoming.duration : 0,
        });
      },

      prev: () => {
        const { tracks, currentTrack, shuffle } = get();
        const playable = tracks.filter((track) => track.source !== 'imported');
        if (playable.length === 0) {
          set({ currentTrack: null, isPlaying: false, progress: 0, duration: 0 });
          return;
        }
        if (!currentTrack || currentTrack.source === 'imported') {
          const first = playable[0];
          set({
            currentTrack: first,
            isPlaying: true,
            progress: 0,
            duration: isUsableDuration(first.duration) ? first.duration : 0,
          });
          return;
        }
        const idx = playable.findIndex((t) => t.id === currentTrack.id);
        const prevIdx = shuffle
          ? Math.floor(Math.random() * playable.length)
          : (idx - 1 + playable.length) % playable.length;
        const previous = playable[prevIdx];
        set({
          currentTrack: previous,
          isPlaying: true,
          progress: 0,
          duration: isUsableDuration(previous.duration) ? previous.duration : 0,
        });
      },

      setVolume: (v) =>
        set({ volume: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8 }),
      setProgress: (p) =>
        set({ progress: Number.isFinite(p) && p >= 0 ? p : 0 }),
      setDuration: (d) =>
        set({ duration: isUsableDuration(d) ? d : 0 }),
      toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

      cycleRepeatMode: () =>
        set((s) => ({
          repeatMode:
            s.repeatMode === 'off' ? 'all' : s.repeatMode === 'all' ? 'one' : 'off',
        })),

      createPlaylist: (name) => {
        const id = uid();
        const playlist: Playlist = {
          id,
          name: name.trim() || 'Untitled playlist',
          trackIds: [],
          createdAt: Date.now(),
        };
        set((s) => ({
          playlists: [...s.playlists, playlist],
          libraryUpdatedAt: Date.now(),
        }));
        return id;
      },

      deletePlaylist: (id) =>
        set((s) => ({
          playlists: s.playlists.filter((p) => p.id !== id),
          libraryUpdatedAt: Date.now(),
        })),

      renamePlaylist: (id, name) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, name: name.trim() || p.name } : p
          ),
          libraryUpdatedAt: Date.now(),
        })),

      addTrackToPlaylist: (playlistId, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.trackIds.includes(trackId)
              ? { ...p, trackIds: [...p.trackIds, trackId] }
              : p
          ),
          libraryUpdatedAt: Date.now(),
        })),

      removeTrackFromPlaylist: (playlistId, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) }
              : p
          ),
          libraryUpdatedAt: Date.now(),
        })),

      clearLibrary: () =>
        set({
          tracks: [],
          playlists: [],
          currentTrack: null,
          isPlaying: false,
          libraryUpdatedAt: Date.now(),
        }),

      replaceLibrary: (tracks, playlists, ownerId, updatedAt) =>
        set((s) => {
          const currentTrack =
            s.currentTrack && tracks.some((t) => t.id === s.currentTrack?.id)
              ? s.currentTrack
              : null;
          return {
            tracks,
            playlists,
            currentTrack,
            isPlaying: false,
            ownerId: ownerId === undefined ? s.ownerId : ownerId,
            libraryUpdatedAt: updatedAt ?? Date.now(),
          };
        }),

      mergeLibrary: (tracks, playlists, ownerId) =>
        set((s) => {
          const trackMap = new Map(s.tracks.map((t) => [t.id, t]));
          for (const t of tracks) trackMap.set(t.id, t);

          const playlistMap = new Map(s.playlists.map((p) => [p.id, p]));
          for (const p of playlists) {
            const existing = playlistMap.get(p.id);
            playlistMap.set(
              p.id,
              existing
                ? {
                    ...existing,
                    ...p,
                    trackIds: Array.from(
                      new Set([...existing.trackIds, ...p.trackIds])
                    ),
                  }
                : p
            );
          }

          return {
            tracks: Array.from(trackMap.values()),
            playlists: Array.from(playlistMap.values()),
            ownerId: ownerId === undefined ? s.ownerId : ownerId,
            libraryUpdatedAt: Date.now(),
          };
        }),

      setOwnerId: (ownerId) => set({ ownerId }),
    }),
    {
      name: 'aurora-library-v1',
      version: 2,
      // Rehydrate after mount (SessionSync does it) so the server-rendered HTML
      // and the first client render match. Otherwise localStorage would make
      // the library appear before hydration and React would warn.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<PlayerState>;
        const volume =
          typeof saved.volume === 'number' && Number.isFinite(saved.volume)
            ? Math.max(0, Math.min(1, saved.volume))
            : current.volume;
        return {
          ...current,
          ...saved,
          volume,
          isPlaying: false,
          progress: 0,
        };
      },
      partialize: (s) => ({
        tracks: s.tracks,
        playlists: s.playlists,
        currentTrack: s.currentTrack,
        volume: s.volume,
        shuffle: s.shuffle,
        repeatMode: s.repeatMode,
        ownerId: s.ownerId,
        libraryUpdatedAt: s.libraryUpdatedAt,
      }),
      onRehydrateStorage: () => (state) => {
        // Never autoplay after a reload; browsers block it anyway.
        if (state) {
          state.isPlaying = false;
          state.progress = 0;
          state.duration = isUsableDuration(state.currentTrack?.duration)
            ? state.currentTrack.duration
            : 0;
        }
      },
    }
  )
);
