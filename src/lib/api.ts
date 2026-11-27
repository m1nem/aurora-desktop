/**
 * Typed Tauri bridge for every Aurora backend command, plus an `/api/*`
 * compatibility router used by the ported client code.
 */
import { invoke } from '@tauri-apps/api/core';
import type {
  AuthUser,
  CommunityPlugin,
  JamSession,
  Playlist,
  SearchResult,
  Track,
  TwoFactorMethod,
  UserPreferences,
} from '@/types';

export interface ApiErrorShape {
  code?: string;
  message?: string;
  status?: number;
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'INTERNAL', status = 500) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !==
      'undefined'
  );
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error) as ApiErrorShape;
      return new ApiError(
        parsed.message || error,
        parsed.code || 'INTERNAL',
        parsed.status || 500
      );
    } catch {
      return new ApiError(error);
    }
  }
  if (error && typeof error === 'object') {
    const shape = error as ApiErrorShape;
    if (shape.message) {
      return new ApiError(
        shape.message,
        shape.code || 'INTERNAL',
        shape.status || 500
      );
    }
  }
  return new ApiError('Unexpected backend error.');
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new ApiError(
      'The Aurora desktop backend is not available in a normal browser. Run `npm run tauri dev`.',
      'NOT_TAURI',
      503
    );
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: unknown): Response {
  const normalized = normalizeError(error);
  return jsonResponse(
    { error: normalized.message, code: normalized.code },
    normalized.status
  );
}

async function fileToBase64(file: File | Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/*  Auth                                                              */
/* ------------------------------------------------------------------ */

export interface LoginResult {
  user?: AuthUser;
  requires2fa?: boolean;
  challengeId?: string;
  methods?: TwoFactorMethod[];
  method?: TwoFactorMethod;
  email?: string;
  emailDelivered?: boolean;
  deliveryError?: string;
  devCode?: string;
}

export function apiLogin(
  identifier: string,
  password: string,
  method?: TwoFactorMethod
) {
  return call<LoginResult>('login', { identifier, password, method });
}

export function apiRegister(email: string, username: string, password: string) {
  return call<{ user: AuthUser }>('register', { email, username, password });
}

export function apiCurrentUser() {
  return call<{ user: AuthUser | null }>('current_user');
}

export function apiLogout(allDevices: boolean) {
  return call<{ ok: boolean }>('logout', { allDevices });
}

export interface TwoFactorChallengeResult {
  ok?: boolean;
  challengeId?: string;
  methods?: TwoFactorMethod[];
  method?: TwoFactorMethod;
  email?: string;
  emailDelivered?: boolean;
  deliveryError?: string;
  devCode?: string;
  expiresInMinutes?: number;
  user?: AuthUser;
}

export function apiTotpSetup() {
  return call<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
    issuer: string;
    account: string;
  }>('totp_setup');
}

export function apiTotpEnable(code: string) {
  return call<{ user: AuthUser }>('totp_enable', { code });
}

export function apiVerifyTwoFactor(challengeId: string, code: string) {
  return call<{ user: AuthUser }>('verify_two_factor', { challengeId, code });
}

export function apiSendTwoFactorEmail(challengeId: string) {
  return call<TwoFactorChallengeResult>('send_two_factor_email', { challengeId });
}

export function apiSetEmailTwoFactor(enabled: boolean) {
  return call<{ user: AuthUser }>('set_email_two_factor', { enabled });
}

export function apiDisableTwoFactor(
  password: string,
  twoFactorCode: string,
  challengeId?: string
) {
  return call<{ ok: boolean; twoFactorDisabled: boolean; user: AuthUser }>(
    'disable_two_factor',
    { password, twoFactorCode, challengeId }
  );
}

export function apiSendDisableTwoFactorEmail() {
  return call<TwoFactorChallengeResult>('send_disable_two_factor_email');
}

/* ------------------------------------------------------------------ */
/*  Library                                                           */
/* ------------------------------------------------------------------ */

export interface LibraryPayload {
  tracks: Track[];
  playlists: Playlist[];
  updatedAt: number;
}

export function apiGetLibrary() {
  return call<LibraryPayload>('get_library');
}

export function apiSaveLibrary(
  tracks: Track[],
  playlists: Playlist[],
  merge = false
) {
  return call<LibraryPayload>('save_library', { tracks, playlists, merge });
}

export function apiRecoverLibrary() {
  return call<{
    tracks: Track[];
    playlists: Playlist[];
    added: number;
    updatedAt: number;
  }>('recover_library');
}

export interface CsvImportResult {
  ok: boolean;
  playlist: Playlist;
  playlists: Playlist[];
  tracks: Track[];
  stats: {
    totalRows: number;
    imported: number;
    duplicates: number;
    skipped: number;
  };
  updatedAt: number;
}

export function apiImportPlaylistCsv(content: string, name?: string) {
  return call<CsvImportResult>('import_playlist_csv', { content, name });
}

export function apiExportPlaylistCsv() {
  return call<{ content: string; filename: string; filePath: string }>(
    'export_playlist_csv'
  );
}

/* ------------------------------------------------------------------ */
/*  Search / media                                                    */
/* ------------------------------------------------------------------ */

export function apiSearch(query: string, allowExternal = false) {
  return call<{ results: SearchResult[]; source: string; external?: boolean }>(
    'search_youtube',
    { query, allowExternal }
  );
}

export function apiSearchExternal(query: string, allowExternal: boolean) {
  return call<{ results: SearchResult[]; source: string; external?: boolean }>(
    'search_youtube_external',
    { query, allowExternal }
  );
}

export interface DownloadResult {
  url: string;
  filename: string;
  cached: boolean;
  track: Track;
}

export function apiDownloadTrack(
  input: {
    id: string;
    title: string;
    author: string;
    album?: string;
    duration?: number;
    thumbnail?: string;
  },
  allowExternal = false
) {
  return call<DownloadResult>('download_track', {
    trackId: input.id,
    title: input.title,
    author: input.author,
    album: input.album,
    duration: input.duration ?? 0,
    thumbnail: input.thumbnail ?? '',
    allowExternal,
  });
}

export async function apiUploadLocalFile(file: File) {
  return call<{
    ok: boolean;
    trackId: string;
    track: Track;
    url: string;
    fileName: string;
    title: string;
    size: number;
    storage: string;
  }>('upload_local_file', {
    fileData: await fileToBase64(file),
    fileName: file.name,
    mimeType: file.type,
  });
}

export type LyricsProvider = 'lrclib' | 'lyricsovh';

export interface LyricsCandidate {
  id: string;
  provider: LyricsProvider;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  instrumental: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LyricsResponse {
  provider: LyricsProvider;
  candidates: LyricsCandidate[];
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export function apiFetchLyrics(
  artist: string,
  title: string,
  provider: LyricsProvider = 'lrclib'
) {
  return call<LyricsResponse>('fetch_lyrics', { artist, title, provider });
}

export function apiResolveMediaUrl(url: string) {
  return call<{ url: string; filePath: string | null }>('resolve_media_url', {
    url,
  });
}

/* ------------------------------------------------------------------ */
/*  Preferences / plugins                                             */
/* ------------------------------------------------------------------ */

export function apiSavePreferences(preferences: UserPreferences) {
  return call<{ ok: boolean; preferences: UserPreferences }>(
    'save_preferences',
    { preferences }
  );
}

export function apiGetPlugins() {
  return call<{
    plugins: unknown[];
    enabled: Record<string, boolean>;
    communityEnabled: Record<string, boolean>;
    authenticated: boolean;
  }>('get_plugin_state');
}

export function apiSavePluginState(input: {
  id?: string;
  enabled?: boolean;
  plugins?: Record<string, boolean>;
}) {
  return call<{ ok: boolean; enabled: Record<string, boolean> }>(
    'save_plugin_state',
    input
  );
}

export function apiListCommunityPlugins() {
  return call<{ uploaded: CommunityPlugin[]; authenticated: boolean }>(
    'list_community_plugins'
  );
}

export function apiUploadCommunityPlugin(input: {
  fileData: string;
  fileName: string;
  name: string;
  author: string;
  version: string;
  description: string;
}) {
  return call<{ ok: boolean; plugin: CommunityPlugin }>(
    'upload_community_plugin',
    input
  );
}

export function apiDeleteCommunityPlugin(id: string) {
  return call<{ ok: boolean; id: string }>('delete_community_plugin', { id });
}

export function apiReadCommunityPlugin(id: string) {
  return call<{ source: string }>('read_community_plugin', { id });
}

/* ------------------------------------------------------------------ */
/*  Jam                                                               */
/* ------------------------------------------------------------------ */

export function apiJamPublish(input: {
  sessionId: string;
  track: Track | null;
  isPlaying: boolean;
  progress: number;
  hostName?: string;
}) {
  return call<{ ok: boolean; sessionId: string; listenersCount: number }>(
    'jam_publish',
    input
  );
}

export function apiJamJoin(sessionId: string, listenerId: string) {
  return call<{ ok: boolean; session: JamSession }>('jam_join', {
    sessionId,
    listenerId,
  });
}

export function apiJamPoll(sessionId: string) {
  return call<{ ok: boolean; session: JamSession }>('jam_poll', { sessionId });
}

export function apiJamLeave(sessionId: string, listenerId: string) {
  return call<{ ok: boolean }>('jam_leave', { sessionId, listenerId });
}

/* ------------------------------------------------------------------ */
/*  Discord                                                           */
/* ------------------------------------------------------------------ */

export function apiSendDiscordActivity(payload: Record<string, unknown>) {
  return call<{ ok: boolean; active: boolean; event: string }>(
    'send_discord_presence',
    { payload }
  );
}

export function apiClearDiscordActivity() {
  return call<{ ok: boolean }>('clear_discord_presence');
}

export function apiDiscordProbe(appId?: string) {
  return call<{
    ok: boolean;
    ready: boolean;
    appId: string | null;
    activity: string | null;
    version: string;
    error?: string;
  }>('discord_probe', { appId });
}

export function apiDiscordStatus() {
  return call<{
    ok: boolean;
    ready: boolean;
    appId: string | null;
    activity: string | null;
    version: string;
    error?: string;
  }>('discord_status');
}

/* ------------------------------------------------------------------ */
/*  Misc                                                              */
/* ------------------------------------------------------------------ */

export function apiGenerateQrCode(data: string, size?: number) {
  return call<{ dataUri: string }>('generate_qr_code', { data, size });
}

// AURORA_FIX_API_DESKTOP_RESTORE_V1
export interface AudioIntegrationStatus {
  supportedMimeTypes: string[];
  supportedExtensions: string[];
  desktopFile: string;
  desktopFileExists: boolean;
  executable: string;
  canRestoreDefaults: boolean;
  defaults: Array<{ mime: string; desktopFile: string | null }>;
}

export function apiAudioIntegrationStatus() {
  return call<AudioIntegrationStatus>('audio_integration_status');
}

export function apiSetDefaultMusicPlayer() {
  return call<AudioIntegrationStatus>('set_default_music_player');
}

export function apiRestoreDefaultMusicPlayer() {
  return call<AudioIntegrationStatus>('restore_default_music_player');
}

export function apiTakeStartupAudio() {
  return call<{ tracks: Track[] }>('take_startup_audio');
}

export interface YtDlpStatus {
  available: boolean;
  source: string | null;
  version: string | null;
  error: string | null;
}

export function apiYtDlpStatus() {
  return call<YtDlpStatus>('ytdlp_status');
}

export function apiSendEmail(to: string, subject: string, body: string) {
  return call<{ delivered: boolean; reason: string | null }>('send_email', {
    to,
    subject,
    body,
  });
}



/* ------------------------------------------------------------------ */
/*  /api/* compatibility router                                       */
/* ------------------------------------------------------------------ */

async function parseBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  if (typeof init.body === 'string') {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (init.body instanceof FormData) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of init.body.entries()) result[key] = value;
    return result;
  }
  return {};
}

async function routeApi(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const path = url.pathname;

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await parseBody(init);
    return jsonResponse(
      await apiLogin(
        String(body.identifier ?? ''),
        String(body.password ?? ''),
        body.method === 'email' || body.method === 'totp' ? body.method : undefined
      )
    );
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const body = await parseBody(init);
    return jsonResponse(
      await apiRegister(
        String(body.email ?? ''),
        String(body.username ?? ''),
        String(body.password ?? '')
      ),
      201
    );
  }

  if (path === '/api/auth/me' && method === 'GET') {
    return jsonResponse(await apiCurrentUser());
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return jsonResponse(await apiLogout(url.searchParams.get('all') === '1'));
  }

  if (path === '/api/auth/2fa/setup' && method === 'POST') {
    return jsonResponse(await apiTotpSetup());
  }

  if (path === '/api/auth/2fa/enable' && method === 'POST') {
    const body = await parseBody(init);
    return jsonResponse(await apiTotpEnable(String(body.code ?? '')));
  }

  if (path === '/api/auth/2fa/verify' && method === 'POST') {
    const body = await parseBody(init);
    return jsonResponse(
      await apiVerifyTwoFactor(
        String(body.challengeId ?? ''),
        String(body.code ?? '')
      )
    );
  }

  if (path === '/api/auth/2fa/send' && method === 'POST') {
    const body = await parseBody(init);
    return jsonResponse(
      await apiSendTwoFactorEmail(String(body.challengeId ?? ''))
    );
  }

  if (path === '/api/auth/2fa/email' && method === 'POST') {
    const body = await parseBody(init);
    return jsonResponse(await apiSetEmailTwoFactor(Boolean(body.enabled)));
  }

  if (
    (path === '/api/auth/disable-2fa' || path === '/api/auth/2fa/disable') &&
    method === 'POST'
  ) {
    const body = await parseBody(init);
    return jsonResponse(
      await apiDisableTwoFactor(
        String(body.password ?? ''),
        String(body.twoFactorCode ?? body.code ?? ''),
        body.challengeId ? String(body.challengeId) : undefined
      )
    );
  }

  if (path === '/api/auth/2fa/disable/send' && method === 'POST') {
    return jsonResponse(await apiSendDisableTwoFactorEmail());
  }

  if (path === '/api/search' && method === 'GET') {
    const query = url.searchParams.get('q') || '';
    if (!query.trim()) {
      return jsonResponse({ error: 'Missing query parameter "q"' }, 400);
    }
    const external = url.searchParams.get('external') === '1';
    const mode = url.searchParams.get('mode');
    return jsonResponse(
      mode === 'external'
        ? await apiSearchExternal(query.trim(), external)
        : await apiSearch(query.trim(), external)
    );
  }

  if (path === '/api/download' && method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400);
    return jsonResponse(
      await apiDownloadTrack(
        {
          id,
          title: url.searchParams.get('title') || `YouTube ${id}`,
          author: url.searchParams.get('author') || 'YouTube',
          album: url.searchParams.get('album') || undefined,
          duration: Number(url.searchParams.get('duration') || 0),
          thumbnail: url.searchParams.get('thumbnail') || '',
        },
        url.searchParams.get('external') === '1'
      )
    );
  }

  if (path === '/api/upload' && method === 'POST') {
    const body = await parseBody(init);
    const file = body.file;
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'No audio file provided' }, 400);
    }
    return jsonResponse(await apiUploadLocalFile(file));
  }

  if (path === '/api/lyrics' && method === 'GET') {
    const artist = url.searchParams.get('artist') || '';
    const title = url.searchParams.get('title') || '';
    if (!artist || !title) {
      return jsonResponse({ error: 'Missing artist or title' }, 400);
    }
    const provider =
      url.searchParams.get('provider') === 'lyricsovh' ? 'lyricsovh' : 'lrclib';
    return jsonResponse(await apiFetchLyrics(artist, title, provider));
  }

  if (path === '/api/library') {
    if (method === 'GET') return jsonResponse(await apiGetLibrary());
    if (method === 'PUT' || method === 'POST') {
      const body = await parseBody(init);
      return jsonResponse(
        await apiSaveLibrary(
          Array.isArray(body.tracks) ? (body.tracks as Track[]) : [],
          Array.isArray(body.playlists) ? (body.playlists as Playlist[]) : [],
          Boolean(body.merge)
        )
      );
    }
  }

  if (path === '/api/library/recover' && method === 'POST') {
    return jsonResponse(await apiRecoverLibrary());
  }

  if (path === '/api/playlists/import' && method === 'POST') {
    const body = await parseBody(init);
    let csv = typeof body.csv === 'string' ? body.csv : '';
    let name = typeof body.name === 'string' ? body.name : '';
    if (body.file instanceof File) {
      csv = await body.file.text();
      if (!name) name = body.file.name.replace(/\.csv$/i, '');
    }
    return jsonResponse(await apiImportPlaylistCsv(csv, name || undefined));
  }

  if (path === '/api/preferences') {
    if (method === 'GET') {
      const current = await apiCurrentUser();
      if (!current.user) {
        return jsonResponse({ error: 'Sign in first.' }, 401);
      }
      return jsonResponse({ preferences: current.user.preferences });
    }
    if (method === 'PUT') {
      const body = await parseBody(init);
      return jsonResponse(
        await apiSavePreferences(body as unknown as UserPreferences)
      );
    }
  }

  if (path === '/api/plugins') {
    if (method === 'GET') return jsonResponse(await apiGetPlugins());
    if (method === 'PUT') {
      const body = await parseBody(init);
      return jsonResponse(await apiSavePluginState(body));
    }
  }

  if (path === '/api/marketplace/plugins' && method === 'GET') {
    return jsonResponse(await apiListCommunityPlugins());
  }

  if (path === '/api/marketplace/plugins/upload' && method === 'POST') {
    const body = await parseBody(init);
    const file = body.file;
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'Choose a .js plugin file.' }, 400);
    }
    return jsonResponse(
      await apiUploadCommunityPlugin({
        fileData: await fileToBase64(file),
        fileName: file.name,
        name: String(body.name ?? ''),
        author: String(body.author ?? ''),
        version: String(body.version ?? '1.0.0'),
        description: String(body.description ?? ''),
      }),
      201
    );
  }

  const pluginFileMatch = path.match(/^\/api\/marketplace\/plugins\/([^/]+)\/file$/);
  if (pluginFileMatch && method === 'GET') {
    const result = await apiReadCommunityPlugin(
      decodeURIComponent(pluginFileMatch[1])
    );
    return new Response(result.source, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const pluginDeleteMatch = path.match(/^\/api\/marketplace\/plugins\/([^/]+)$/);
  if (pluginDeleteMatch && method === 'DELETE') {
    return jsonResponse(
      await apiDeleteCommunityPlugin(decodeURIComponent(pluginDeleteMatch[1]))
    );
  }

  if (path === '/api/jam') {
    if (method === 'GET') {
      return jsonResponse(await apiJamPoll(url.searchParams.get('sessionId') || ''));
    }
    if (method === 'POST') {
      const body = await parseBody(init);
      if (body.action === 'publish') {
        return jsonResponse(
          await apiJamPublish({
            sessionId: String(body.sessionId ?? ''),
            track: (body.track as Track | null) ?? null,
            isPlaying: Boolean(body.isPlaying),
            progress: Number(body.progress ?? 0),
            hostName: body.hostName ? String(body.hostName) : undefined,
          })
        );
      }
      if (body.action === 'join') {
        return jsonResponse(
          await apiJamJoin(
            String(body.sessionId ?? ''),
            String(body.listenerId ?? '')
          )
        );
      }
      if (body.action === 'leave') {
        return jsonResponse(
          await apiJamLeave(
            String(body.sessionId ?? ''),
            String(body.listenerId ?? '')
          )
        );
      }
      return jsonResponse({ ok: false, error: 'unknown action' }, 400);
    }
  }

  if (path === '/api/discord') {
    if (method === 'POST') {
      const body = await parseBody(init);
      if (body.action === 'clear') {
        return jsonResponse(await apiClearDiscordActivity());
      }
      return jsonResponse(
        await apiSendDiscordActivity(body as Record<string, unknown>)
      );
    }
    if (method === 'GET') return jsonResponse(await apiDiscordStatus());
  }

  return jsonResponse({ error: `Unknown API route: ${method} ${path}` }, 404);
}

/**
 * Drop-in `fetch` replacement for the ported `/api/*` calls.
 * Returns a real `Response`, so existing `res.ok` / `res.json()` code works.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  try {
    const url = new URL(raw, 'http://aurora.local');
    if (!url.pathname.startsWith('/api/')) {
      return fetch(input, init);
    }
    return await routeApi(url, init);
  } catch (error) {
    return errorResponse(error);
  }
}
