// AURORA_PATCH: plugin catalog & feature-flag definitions v2 (local-first)

export type PluginId = 'lyricsOverlay' | 'equalizer' | 'ytdlp';

export interface PluginManifest {
  id: PluginId;
  name: string;
  version: string;
  author: string;
  description: string;
  wip: boolean;
  defaultEnabled: boolean;
  capabilities: string[];
}

export type PluginPreferences = Record<PluginId, boolean>;

export const PLUGIN_CATALOG: PluginManifest[] = [
  {
    id: 'lyricsOverlay',
    name: 'Lyrics Overlay',
    version: '1.0.0',
    author: 'AuroraMP|AURORA_MP|AURORA_PATCH',
    description:
      'Adds the lyrics panel to the player and looks up lyrics for the current track.',
    wip: false,
    defaultEnabled: true,
    capabilities: ['lyrics-lookup', 'player-panel'],
  },
  {
    id: 'ytdlp',
    name: 'YouTube Downloader (yt-dlp)',
    version: '1.0.0',
    author: 'AuroraMP|AURORA_MP|AURORA_PATCH',
    description:
      'Optional external integration for yt-dlp searches and MP3 downloads. Disabled by default; requires yt-dlp and ffmpeg.',
    wip: false,
    defaultEnabled: false,
    capabilities: ['external-downloads', 'yt-dlp', 'local-library'],
  },
  {
    id: 'equalizer',
    name: 'Equalizer',
    version: '0.1.0',
    author: 'AuroraMP|AURORA_MP|AURORA_PATCH',
    description:
      'Feature flag reserved for future Web Audio equalizer and tone controls.',
    wip: false,
    defaultEnabled: false,
    capabilities: ['audio-processing', 'presets'],
  },
];

export const PLUGIN_IDS = PLUGIN_CATALOG.map((plugin) => plugin.id);

export const DEFAULT_PLUGIN_PREFERENCES: PluginPreferences = Object.fromEntries(
  PLUGIN_CATALOG.map((plugin) => [plugin.id, plugin.defaultEnabled])
) as PluginPreferences;

export function isPluginId(value: unknown): value is PluginId {
  return typeof value === 'string' && PLUGIN_IDS.includes(value as PluginId);
}

export function normalizePluginPreferences(
  value: unknown,
  fallback: PluginPreferences = DEFAULT_PLUGIN_PREFERENCES
): PluginPreferences {
  const raw = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

  return PLUGIN_CATALOG.reduce((preferences, plugin) => {
    preferences[plugin.id] =
      typeof raw[plugin.id] === 'boolean'
        ? (raw[plugin.id] as boolean)
        : fallback[plugin.id];
    return preferences;
  }, {} as PluginPreferences);
}

export function pluginById(id: PluginId): PluginManifest | undefined {
  return PLUGIN_CATALOG.find((plugin) => plugin.id === id);
}
