// AURORA_PATCH: shared user preferences v1 - profile + localStorage payloads
import type { UserPreferences } from '@/types';
import {
  DEFAULT_PLUGIN_PREFERENCES,
  normalizePluginPreferences,
} from './plugins';
import {
  DEFAULT_THEME,
  customizationForTheme,
  normalizeCustomization,
  normalizeTheme,
  type PlayerCustomization,
} from './themes';

export const MAX_CUSTOM_CSS_LENGTH = 50_000;
export const MAX_COMMUNITY_PLUGIN_STATES = 200;
const COMMUNITY_PLUGIN_ID_PATTERN = /^plg-[a-z0-9-]{1,64}$/i;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: DEFAULT_THEME,
  plugins: { ...DEFAULT_PLUGIN_PREFERENCES },
  communityPlugins: {},
  customCss: '',
  playerCustomization: customizationForTheme(DEFAULT_THEME),
};

export function sanitizeCustomCss(
  value: unknown,
  fallback = ''
): string {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(/\0/g, '')
    .slice(0, MAX_CUSTOM_CSS_LENGTH);
}

export function normalizeCommunityPluginStates(
  value: unknown,
  fallback: Record<string, boolean> = {}
): Record<string, boolean> {
  const next: Record<string, boolean> = { ...fallback };
  const raw = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

  for (const [id, enabled] of Object.entries(raw)) {
    if (typeof enabled !== 'boolean') continue;
    if (!COMMUNITY_PLUGIN_ID_PATTERN.test(id)) continue;

    if (
      !(id in next) &&
      Object.keys(next).length >= MAX_COMMUNITY_PLUGIN_STATES
    ) {
      continue;
    }

    next[id] = enabled;
  }

  return next;
}

function sameBooleanMap(
  a: Record<string, boolean>,
  b: Record<string, boolean>
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export function normalizePreferences(
  input: unknown,
  fallback: UserPreferences = DEFAULT_USER_PREFERENCES
): UserPreferences {
  const raw = input && typeof input === 'object'
    ? (input as Record<string, unknown>)
    : {};

  const theme =
    raw.theme === undefined ? normalizeTheme(fallback.theme) : normalizeTheme(raw.theme);
  const customizationFallback =
    raw.theme !== undefined && raw.playerCustomization === undefined
      ? customizationForTheme(theme)
      : normalizeCustomization(fallback.playerCustomization, customizationForTheme(theme));

  return {
    theme,
    plugins:
      raw.plugins === undefined
        ? normalizePluginPreferences(fallback.plugins)
        : normalizePluginPreferences(raw.plugins, fallback.plugins),
    communityPlugins:
      raw.communityPlugins === undefined
        ? normalizeCommunityPluginStates(fallback.communityPlugins)
        : normalizeCommunityPluginStates(raw.communityPlugins),
    customCss:
      raw.customCss === undefined
        ? sanitizeCustomCss(fallback.customCss)
        : sanitizeCustomCss(raw.customCss, fallback.customCss),
    playerCustomization: normalizeCustomization(
      raw.playerCustomization,
      customizationFallback
    ),
  };
}

export function preferencesFromSnapshot(snapshot: {
  theme: UserPreferences['theme'];
  plugins: UserPreferences['plugins'];
  communityPlugins: UserPreferences['communityPlugins'];
  customCss: string;
  playerCustomization: PlayerCustomization;
}): UserPreferences {
  return normalizePreferences(snapshot);
}

export function samePreferences(a: UserPreferences, b: UserPreferences): boolean {
  return (
    a.theme === b.theme &&
    a.customCss === b.customCss &&
    a.playerCustomization.background === b.playerCustomization.background &&
    a.playerCustomization.accentColor === b.playerCustomization.accentColor &&
    a.playerCustomization.fontSize === b.playerCustomization.fontSize &&
    // AURORA_FIX_PREFS_YTDLP_V1
    a.plugins.lyricsOverlay === b.plugins.lyricsOverlay &&
    a.plugins.equalizer === b.plugins.equalizer &&
    a.plugins.ytdlp === b.plugins.ytdlp &&
    sameBooleanMap(a.communityPlugins, b.communityPlugins)
  );
}
