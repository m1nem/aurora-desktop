import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LyricsCandidate, LyricsProvider } from '@/lib/api';

export interface LyricsSelection {
  key: string;
  provider: LyricsProvider;
  candidate: LyricsCandidate;
  savedAt: number;
}

interface LyricsState {
  provider: LyricsProvider;
  selections: Record<string, LyricsSelection>;
  setProvider: (provider: LyricsProvider) => void;
  selectCandidate: (key: string, candidate: LyricsCandidate) => void;
  clearSelection: (key: string) => void;
}

const MAX_SELECTIONS = 120;

function trimSelections(
  selections: Record<string, LyricsSelection>
): Record<string, LyricsSelection> {
  const entries = Object.entries(selections);
  if (entries.length <= MAX_SELECTIONS) return selections;
  return Object.fromEntries(
    entries
      .sort((left, right) => right[1].savedAt - left[1].savedAt)
      .slice(0, MAX_SELECTIONS)
  );
}

export const useLyricsStore = create<LyricsState>()(
  persist(
    (set) => ({
      provider: 'lrclib',
      selections: {},
      setProvider: (provider) => set({ provider }),
      selectCandidate: (key, candidate) =>
        set((state) => ({
          selections: trimSelections({
            ...state.selections,
            [key]: {
              key,
              provider: candidate.provider,
              candidate,
              savedAt: Date.now(),
            },
          }),
        })),
      clearSelection: (key) =>
        set((state) => {
          const selections = { ...state.selections };
          delete selections[key];
          return { selections };
        }),
    }),
    {
      name: 'aurora-lyrics-v1',
      version: 1,
      partialize: (state) => ({
        provider: state.provider,
        selections: state.selections,
      }),
    }
  )
);
