// AURORA_PATCH: types v5 - plugins, custom themes and user preferences
import type { PluginPreferences } from '@/lib/plugins';
import type { PlayerCustomization, ThemeId } from '@/lib/themes';

export type TrackSource = 'youtube' | 'local' | 'cloud' | 'imported';

export interface Track {
  id: string;
  title: string;
  author: string;
  album?: string; // Clean album/source metadata from YouTube Music
  duration: number; // in seconds
  thumbnail: string;
  url: string;
  /** Absolute path on disk for locally managed audio (Tauri asset protocol). */
  filePath?: string;
  source: TrackSource;
  cloudUrl?: string; // Persistent shared URL for Listen Along
  externalUri?: string; // Original URI from an imported playlist (e.g. spotify:track:...)
  fileSize?: number;
  uploadedAt?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  author: string;
  album?: string;
  duration: number;
  thumbnail: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export type TwoFactorMethod = 'totp' | 'email';

/** Persisted metadata for a community-uploaded JavaScript plugin. */
export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  filePath: string;
  enabledState: boolean;
  ownerId: string;
  ownerName: string;
  createdAt: number;
}

/** Community plugin metadata returned by the Marketplace API. */
export interface CommunityPlugin extends PluginRecord {
  source: 'uploaded';
  enabled: boolean;
  canDelete: boolean;
  fileUrl: string;
}

export interface UserPreferences {
  theme: ThemeId;
  plugins: PluginPreferences;
  /** Per-user enabled flags for uploaded community plugins, keyed by plugin id. */
  communityPlugins: Record<string, boolean>;
  customCss: string;
  playerCustomization: PlayerCustomization;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  createdAt: number;
  preferences: UserPreferences;
  twoFactor: {
    enabled: boolean;
    method: TwoFactorMethod;
    totpEnabled: boolean;
    emailEnabled: boolean;
    enabledAt?: number;
  };
}

export interface JamSession {
  sessionId: string;
  hostName: string;
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  updatedAt: number; // Monotonic epoch millis
  listenersCount: number;
}

export interface JamSyncPayload {
  action: 'sync' | 'play' | 'pause' | 'seek' | 'track_change' | 'join' | 'leave';
  sessionId: string;
  track?: Track | null;
  isPlaying?: boolean;
  progress?: number;
  timestamp?: number;
}

export interface DiscordActivityPayload {
  track: {
    id: string;
    title: string;
    author: string;
    album?: string;
    source?: string;
    duration?: number;
    thumbnail?: string;
  };
  isPlaying: boolean;
  progress?: number;
  duration?: number;
  sessionId?: string; // For "Listen Along" button
  appId?: string;
}
