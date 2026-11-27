'use client';

// AURORA_PATCH: community plugin list store v1
import { apiFetch } from '@/lib/api';
import { create } from 'zustand';
import type { CommunityPlugin } from '@/types';

interface PluginState {
  uploadedPlugins: CommunityPlugin[];
  loading: boolean;
  error: string | null;
  fetchPlugins: () => Promise<void>;
  addPlugin: (plugin: CommunityPlugin) => void;
  removePlugin: (id: string) => void;
}

export const usePluginStore = create<PluginState>((set) => ({
  uploadedPlugins: [],
  loading: false,
  error: null,

  fetchPlugins: async () => {
    set({ loading: true, error: null });

    try {
      const response = await apiFetch('/api/marketplace/plugins', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });

      const data = (await response.json().catch(() => ({}))) as {
        uploaded?: unknown;
        error?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : `Failed to load community plugins (${response.status}).`
        );
      }

      const uploaded = Array.isArray(data.uploaded)
        ? (data.uploaded as CommunityPlugin[])
        : [];

      set({ uploadedPlugins: uploaded, loading: false, error: null });
    } catch (error) {
      set({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load community plugins.',
      });
    }
  },

  addPlugin: (plugin) =>
    set((state) => ({
      uploadedPlugins: [
        plugin,
        ...state.uploadedPlugins.filter((item) => item.id !== plugin.id),
      ],
      error: null,
    })),

  removePlugin: (id) =>
    set((state) => ({
      uploadedPlugins: state.uploadedPlugins.filter(
        (plugin) => plugin.id !== id
      ),
    })),
}));
