// Shared Discord Rich Presence configuration for local desktop IPC.

export const DEFAULT_DISCORD_APP_ID = '1548485673789423636';
export type DiscordAppIdMode = 'default' | 'custom';

export const DISCORD_BRIDGE_PORT = 8080;
export const DISCORD_BRIDGE_URL = `http://127.0.0.1:${DISCORD_BRIDGE_PORT}`;

export const DISCORD_SMALL_IMAGE_KEY = 'auroramp_logo';
export const DISCORD_SMALL_IMAGE_TEXT = 'AuroraMP|AURORA_MP|AURORA_PATCH';
export const DISCORD_LARGE_IMAGE_FALLBACK = 'aurora_logo';

const DISCORD_TEXT_LIMIT = 128;

export interface DiscordButton {
  label: string;
  url: string;
}

export interface DiscordTimestamps {
  start: number;
  end?: number;
}

export interface DiscordAssets {
  large_image: string;
  large_text: string;
  small_image: string;
  small_text: string;
}

export interface DiscordPresenceText {
  details: string;
  state: string;
}

export function isValidDiscordAppId(appId?: string | null): boolean {
  return typeof appId === 'string' && /^\d{17,20}$/.test(appId.trim());
}

export function discordSourceLabel(source?: string | null): string {
  switch (source) {
    case 'youtube':
      return 'YouTube Music';
    case 'local':
      return 'Local library';
    default:
      return 'AuroraMP|AURORA_MP|AURORA_PATCH';
  }
}

function truncateDiscordText(value: string, fallback: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim() || fallback;
  return trimmed.slice(0, DISCORD_TEXT_LIMIT);
}

export function buildDiscordPresenceText(options: {
  title: string;
  author: string;
  isPlaying: boolean;
  source?: string | null;
}): DiscordPresenceText {
  const details = truncateDiscordText(options.title, 'Unknown title');
  const author = truncateDiscordText(options.author, 'Unknown artist');
  const source = discordSourceLabel(options.source);

  let state = author === details ? source : `${author} • ${source}`;
  if (state === details) state = `${source} • AuroraMP|AURORA_MP|AURORA_PATCH`;

  if (!options.isPlaying) state = `Paused • ${state}`;
  if (state === details) state = `${state} • AuroraMP|AURORA_MP|AURORA_PATCH`;

  return {
    details,
    state: state.slice(0, DISCORD_TEXT_LIMIT),
  };
}

export function buildDiscordAssets(options: {
  title: string;
  thumbnail?: string | null;
}): DiscordAssets {
  const largeImage =
    typeof options.thumbnail === 'string' &&
    /^https:\/\//i.test(options.thumbnail)
      ? options.thumbnail
      : DISCORD_LARGE_IMAGE_FALLBACK;

  return {
    large_image: largeImage,
    large_text: truncateDiscordText(options.title, 'Unknown title'),
    small_image: DISCORD_SMALL_IMAGE_KEY,
    small_text: DISCORD_SMALL_IMAGE_TEXT,
  };
}

export function buildDiscordButtons(
  _trackId: string,
  _sessionId?: string
): DiscordButton[] {
  return [];
}

export function buildDiscordTimestamps(
  isPlaying: boolean,
  progressSeconds: number,
  durationSeconds: number,
  now: number = Date.now()
): DiscordTimestamps | undefined {
  if (!isPlaying) return undefined;

  const progress = Math.max(0, Number(progressSeconds) || 0);
  const duration = Math.max(0, Number(durationSeconds) || 0);

  const start = Math.floor(now - progress * 1000);
  const timestamps: DiscordTimestamps = { start };

  if (duration > 0) {
    const end = Math.floor(now + Math.max(0, duration - progress) * 1000);
    if (end > start) timestamps.end = end;
  }

  return timestamps;
}
