// AURORA_PATCH: settings store v4 - plugins, custom themes and player palette
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_DISCORD_APP_ID, type DiscordAppIdMode } from '@/lib/discordConfig';
import {
  DEFAULT_PLUGIN_PREFERENCES,
  normalizePluginPreferences,
  type PluginId,
  type PluginPreferences,
} from '@/lib/plugins';
import {
  DEFAULT_PLAYER_CUSTOMIZATION,
  customizationForTheme,
  normalizeCustomization,
  normalizeTheme,
  type PlayerCustomization,
  type ThemeId,
} from '@/lib/themes';
import {
  DEFAULT_USER_PREFERENCES,
  normalizeCommunityPluginStates,
  sanitizeCustomCss,
} from '@/lib/preferences';
import type { UserPreferences } from '@/types';

export { DEFAULT_DISCORD_APP_ID };
export type Theme = ThemeId;

interface SettingsState {
  discordEnabled: boolean;
  discordMode: DiscordAppIdMode;
  discordCustomAppId: string;
  /** Effective ID used by the player/Discord IPC. */
  discordAppId: string;
  theme: ThemeId;
  plugins: PluginPreferences;
  communityPlugins: Record<string, boolean>;
  customCss: string;
  playerCustomization: PlayerCustomization;
  /**
   * User whose profile preferences are currently hydrated into this store.
   * Community plugins must not execute from stale localStorage flags before
   * the signed-in user's profile has replaced them.
   */
  profileHydratedUserId: string | null;

  setDiscordEnabled: (v: boolean) => void;
  setDiscordMode: (mode: DiscordAppIdMode) => void;
  setDiscordCustomAppId: (v: string) => void;
  setTheme: (t: ThemeId) => void;
  setPlugin: (id: PluginId, enabled: boolean) => void;
  setCommunityPlugin: (id: string, enabled: boolean) => void;
  removeCommunityPlugin: (id: string) => void;
  setCustomCss: (css: string) => void;
  setPlayerCustomization: (patch: Partial<PlayerCustomization>) => void;
  hydrateFromProfile: (
    preferences?: UserPreferences | null,
    userId?: string | null
  ) => void;
  reset: () => void;
}

const initialPreferences = {
  theme: DEFAULT_USER_PREFERENCES.theme,
  plugins: { ...DEFAULT_USER_PREFERENCES.plugins },
  communityPlugins: { ...DEFAULT_USER_PREFERENCES.communityPlugins },
  customCss: DEFAULT_USER_PREFERENCES.customCss,
  playerCustomization: { ...DEFAULT_USER_PREFERENCES.playerCustomization },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      discordEnabled: true,
      discordMode: 'default',
      discordCustomAppId: DEFAULT_DISCORD_APP_ID,
      discordAppId: DEFAULT_DISCORD_APP_ID,
      ...initialPreferences,
      profileHydratedUserId: null,

      setDiscordEnabled: (v) => set({ discordEnabled: v }),
      setDiscordMode: (mode) =>
        set((state) => ({
          discordMode: mode,
          discordAppId:
            mode === 'default'
              ? DEFAULT_DISCORD_APP_ID
              : state.discordCustomAppId.trim() || DEFAULT_DISCORD_APP_ID,
        })),
      setDiscordCustomAppId: (value) => {
        const next = value.trim();
        set((state) => ({
          discordCustomAppId: next,
          discordAppId:
            state.discordMode === 'custom'
              ? next || DEFAULT_DISCORD_APP_ID
              : state.discordAppId,
        }));
      },
      setTheme: (theme) =>
        set((state) => {
          const nextTheme = normalizeTheme(theme);
          return {
            theme: nextTheme,
            playerCustomization: {
              ...customizationForTheme(nextTheme),
              fontSize: state.playerCustomization.fontSize,
            },
          };
        }),
      setPlugin: (id, enabled) =>
        set((state) => ({
          plugins: {
            ...state.plugins,
            [id]: enabled,
          },
        })),
      setCommunityPlugin: (id, enabled) =>
        set((state) => ({
          communityPlugins: normalizeCommunityPluginStates({
            ...state.communityPlugins,
            [id]: enabled,
          }),
        })),
      removeCommunityPlugin: (id) =>
        set((state) => {
          const communityPlugins = { ...state.communityPlugins };
          delete communityPlugins[id];
          return { communityPlugins };
        }),
      setCustomCss: (css) => set({ customCss: sanitizeCustomCss(css) }),
      setPlayerCustomization: (patch) =>
        set((state) => ({
          playerCustomization: normalizeCustomization(
            { ...state.playerCustomization, ...patch },
            state.playerCustomization
          ),
        })),
      hydrateFromProfile: (preferences, userId) => {
        if (!preferences) return;
        set({
          theme: normalizeTheme(preferences.theme),
          plugins: normalizePluginPreferences(preferences.plugins),
          communityPlugins: normalizeCommunityPluginStates(
            preferences.communityPlugins
          ),
          customCss: sanitizeCustomCss(preferences.customCss),
          playerCustomization: normalizeCustomization(
            preferences.playerCustomization,
            customizationForTheme(normalizeTheme(preferences.theme))
          ),
          profileHydratedUserId: userId ?? null,
        });
      },
      reset: () =>
        set({
          discordEnabled: true,
          discordMode: 'default',
          discordCustomAppId: DEFAULT_DISCORD_APP_ID,
          discordAppId: DEFAULT_DISCORD_APP_ID,
          theme: initialPreferences.theme,
          plugins: { ...initialPreferences.plugins },
          communityPlugins: { ...initialPreferences.communityPlugins },
          customCss: initialPreferences.customCss,
          playerCustomization: { ...initialPreferences.playerCustomization },
        }),
    }),
    {
      name: 'aurora-settings',
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<SettingsState>;
        const theme = normalizeTheme(persisted.theme);
        const legacyCustom =
          persisted.discordAppId &&
          persisted.discordAppId !== DEFAULT_DISCORD_APP_ID
            ? persisted.discordAppId
            : DEFAULT_DISCORD_APP_ID;
        const discordMode: DiscordAppIdMode =
          persisted.discordMode === 'custom' ||
          (!persisted.discordMode && legacyCustom !== DEFAULT_DISCORD_APP_ID)
            ? 'custom'
            : 'default';
        const discordCustomAppId = (
          persisted.discordCustomAppId ?? legacyCustom
        ).trim() || DEFAULT_DISCORD_APP_ID;
        return {
          ...currentState,
          ...persisted,
          // Never trust a persisted hydration marker across page loads.
          profileHydratedUserId: null,
          discordEnabled: persisted.discordEnabled ?? true,
          discordMode,
          discordCustomAppId,
          discordAppId:
            discordMode === 'custom'
              ? discordCustomAppId
              : DEFAULT_DISCORD_APP_ID,
          theme,
          plugins: normalizePluginPreferences(
            persisted.plugins,
            DEFAULT_PLUGIN_PREFERENCES
          ),
          communityPlugins: normalizeCommunityPluginStates(
            persisted.communityPlugins
          ),
          customCss: sanitizeCustomCss(persisted.customCss),
          playerCustomization: normalizeCustomization(
            persisted.playerCustomization,
            customizationForTheme(theme)
          ),
        };
      },
    }
  )
);

/** Snapshot consumed by profile-sync and the preferences API. */
export function settingsPreferencesSnapshot(
  state: Pick<
    SettingsState,
    'theme' | 'plugins' | 'communityPlugins' | 'customCss' | 'playerCustomization'
  >
): UserPreferences {
  return {
    theme: normalizeTheme(state.theme),
    plugins: normalizePluginPreferences(state.plugins),
    communityPlugins: normalizeCommunityPluginStates(state.communityPlugins),
    customCss: sanitizeCustomCss(state.customCss),
    playerCustomization: {
      ...DEFAULT_PLAYER_CUSTOMIZATION,
      ...state.playerCustomization,
    },
  };
}
