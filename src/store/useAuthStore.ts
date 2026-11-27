// AURORA_PATCH: auth/sync client store v1
import { create } from 'zustand';
import type { AuthUser } from '@/types';

interface AuthState {
  user: AuthUser | null;
  /** Initial session + library bootstrap finished. */
  ready: boolean;
  loading: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;

  setUser: (user: AuthUser | null) => void;
  setReady: (ready: boolean) => void;
  setLoading: (loading: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  setSyncError: (error: string | null) => void;
  setLastSyncAt: (timestamp: number) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  loading: true,
  syncing: false,
  lastSyncAt: null,
  syncError: null,

  setUser: (user) => set({ user }),
  setReady: (ready) => set({ ready }),
  setLoading: (loading) => set({ loading }),
  setSyncing: (syncing) => set({ syncing }),
  setSyncError: (syncError) => set({ syncError }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  reset: () =>
    set({
      user: null,
      ready: true,
      loading: false,
      syncing: false,
      lastSyncAt: null,
      syncError: null,
    }),
}));
