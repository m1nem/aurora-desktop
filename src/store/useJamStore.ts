// AURORA_PATCH: useJamStore v1 - Jam Session & Listen Along State
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '@/types';

interface JamState {
  sessionId: string | null;
  isHost: boolean;
  isJoined: boolean;
  listenersCount: number;
  hostTrack: Track | null;
  hostIsPlaying: boolean;
  hostProgress: number;
  lastUpdated: number;

  createJam: () => string;
  joinJam: (sessionId: string) => void;
  leaveJam: () => void;
  setListenersCount: (count: number) => void;
  updateHostState: (payload: {
    track: Track | null;
    isPlaying: boolean;
    progress: number;
    updatedAt?: number;
  }) => void;
}

const generateSessionId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `jam-${result}`;
};

export const useJamStore = create<JamState>()(
  persist(
    (set) => ({
      sessionId: null,
      isHost: false,
      isJoined: false,
      listenersCount: 1,
      hostTrack: null,
      hostIsPlaying: false,
      hostProgress: 0,
      lastUpdated: Date.now(),

      createJam: () => {
        const id = generateSessionId();
        set({
          sessionId: id,
          isHost: true,
          isJoined: true,
          listenersCount: 1,
          lastUpdated: Date.now(),
        });
        return id;
      },

      joinJam: (sessionId: string) => {
        set({
          sessionId: sessionId.trim(),
          isHost: false,
          isJoined: true,
          lastUpdated: Date.now(),
        });
      },

      leaveJam: () => {
        set({
          sessionId: null,
          isHost: false,
          isJoined: false,
          listenersCount: 1,
          hostTrack: null,
          hostIsPlaying: false,
          hostProgress: 0,
        });
      },

      setListenersCount: (count: number) => set({ listenersCount: count }),

      updateHostState: (payload) =>
        set({
          hostTrack: payload.track,
          hostIsPlaying: payload.isPlaying,
          hostProgress: payload.progress,
          lastUpdated: payload.updatedAt || Date.now(),
        }),
    }),
    {
      name: 'aurora-jam-session',
      partialize: (s) => ({
        sessionId: s.sessionId,
        isHost: s.isHost,
        isJoined: s.isJoined,
      }),
    }
  )
);
