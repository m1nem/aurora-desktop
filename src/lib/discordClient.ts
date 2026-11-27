// AURORA_PATCH: discordClient v3 - native Tauri IPC dispatcher.
//
// The desktop app talks to the Discord desktop client directly from Rust
// (`discord/ipc.rs` on a dedicated thread). No local HTTP bridge is needed.
import type { Track } from '@/types';
import {
  apiClearDiscordActivity,
  apiDiscordProbe,
  apiDiscordStatus,
  apiSendDiscordActivity,
} from './api';
import { isValidDiscordAppId } from './discordConfig';

export type DiscordPresenceEvent =
  | 'track_change'
  | 'play'
  | 'resume'
  | 'pause'
  | 'seek'
  | 'sync';

export interface SendActivityParams {
  event?: DiscordPresenceEvent;
  track: Track;
  isPlaying: boolean;
  progress: number;
  duration?: number;
  sessionId?: string;
  appId?: string;
}

export interface BridgeStatus {
  ok: boolean;
  ready: boolean;
  appId: string | null;
  activity: string | null;
  version: string;
  error?: string;
}

let lastRequestKey = '';
let lastRequestAt = 0;

function buildRequestKey(
  params: SendActivityParams,
  duration: number,
  progress: number
): string {
  return [
    params.event ?? 'sync',
    params.track.id,
    params.track.title,
    params.track.author,
    params.track.source || '',
    params.isPlaying ? '1' : '0',
    Math.round(progress),
    Math.round(duration),
    params.sessionId || 'live',
    params.appId || '',
  ].join('|');
}

export async function sendDiscordActivity(
  params: SendActivityParams
): Promise<boolean> {
  const duration = Math.max(
    0,
    Number(params.duration || params.track.duration || 0)
  );
  const progress = Math.max(0, Number(params.progress || 0));
  const key = buildRequestKey(params, duration, progress);
  const now = Date.now();

  // React Strict Mode and rapid UI events can emit the same update twice.
  if (key === lastRequestKey && now - lastRequestAt < 300) {
    return true;
  }

  lastRequestKey = key;
  lastRequestAt = now;

  try {
    const result = await apiSendDiscordActivity({
      action: 'set',
      event: params.event ?? 'sync',
      appId: isValidDiscordAppId(params.appId) ? params.appId!.trim() : undefined,
      track: {
        id: params.track.id,
        title: params.track.title,
        author: params.track.author,
        album: params.track.album,
        source: params.track.source,
        thumbnail: params.track.thumbnail || '',
        duration,
      },
      isPlaying: params.isPlaying,
      progress,
      duration,
      sessionId: params.sessionId || 'live',
      sentAt: now,
    });
    return result.ok;
  } catch {
    return false;
  }
}

export async function clearDiscordActivity(): Promise<void> {
  lastRequestKey = '';
  lastRequestAt = 0;
  try {
    await apiClearDiscordActivity();
  } catch {
    // Discord may not be running; nothing else to do.
  }
}

/**
 * Used on pagehide/beforeunload. A fire-and-forget invoke is the best effort
 * available while the WebView is being torn down; the Rust worker also clears
 * the activity when the window closes.
 */
export function clearDiscordActivityBeacon(): void {
  lastRequestKey = '';
  lastRequestAt = 0;
  void apiClearDiscordActivity().catch(() => {});
}

function toBridgeStatus(status: {
  ok: boolean;
  ready: boolean;
  appId: string | null;
  activity: string | null;
  version: string;
  error?: string;
}): BridgeStatus {
  return {
    ok: status.ok,
    ready: status.ready,
    appId: status.appId,
    activity: status.activity,
    version: status.version,
    error: status.error,
  };
}

export async function checkBridgeStatus(): Promise<BridgeStatus> {
  try {
    return toBridgeStatus(await apiDiscordStatus());
  } catch (error) {
    return {
      ok: false,
      ready: false,
      appId: null,
      activity: null,
      version: 'unknown',
      error:
        error instanceof Error ? error.message : 'Discord IPC unavailable',
    };
  }
}

/** Actively opens the Discord IPC socket so "Test Connection" is meaningful. */
export async function probeDiscordConnection(
  appId?: string
): Promise<BridgeStatus> {
  try {
    return toBridgeStatus(await apiDiscordProbe(appId));
  } catch (error) {
    return {
      ok: false,
      ready: false,
      appId: appId ?? null,
      activity: null,
      version: 'unknown',
      error:
        error instanceof Error ? error.message : 'Discord IPC unavailable',
    };
  }
}
