// AURORA_PATCH: account library sync engine v2 (local SQLite backend)
// Local state is persisted by zustand. When signed in, changes are pushed to
// the account's SQLite library through the typed Tauri IPC library commands
// (debounced). Bootstrap pulls the account library back after session restore.
'use client';

import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import type { AuthUser, Playlist, Track } from '@/types';

interface ServerLibrary {
  tracks: Track[];
  playlists: Playlist[];
  updatedAt: number;
}

let started = false;
let bootstrapped: Promise<void> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let pushQueued = false;
let applyingRemote = false;
let dirty = false;

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchServerLibrary(): Promise<ServerLibrary | null> {
  try {
    const res = await apiFetch('/api/library', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return readJson<ServerLibrary>(res);
  } catch {
    return null;
  }
}

async function pushLibrary(
  merge: boolean,
  keepalive = false
): Promise<ServerLibrary | null> {
  const auth = useAuthStore.getState();
  const user = auth.user;
  if (!user) return null;

  if (pushInFlight) {
    pushQueued = true;
    return null;
  }

  pushInFlight = true;
  auth.setSyncing(true);

  try {
    const local = usePlayerStore.getState();
    const res = await apiFetch('/api/library', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive,
      body: JSON.stringify({
        tracks: local.tracks,
        playlists: local.playlists,
        merge,
      }),
    });

    if (res.status === 401) {
      useAuthStore.getState().setUser(null);
      useAuthStore.getState().setSyncError('Your session expired. Sign in again.');
      return null;
    }

    if (!res.ok) {
      const data = await readJson<{ error?: string }>(res);
      useAuthStore
        .getState()
        .setSyncError(data?.error || `Sync failed (HTTP ${res.status})`);
      return null;
    }

    const saved = await readJson<ServerLibrary>(res);
    if (saved) {
      useAuthStore.getState().setLastSyncAt(saved.updatedAt);
      useAuthStore.getState().setSyncError(null);
      if (merge) {
        applyingRemote = true;
        usePlayerStore
          .getState()
          .replaceLibrary(
            saved.tracks,
            saved.playlists,
            useAuthStore.getState().user?.id ?? null,
            saved.updatedAt
          );
        applyingRemote = false;
      }
    }

    dirty = false;
    return saved;
  } catch (err) {
    useAuthStore
      .getState()
      .setSyncError(err instanceof Error ? err.message : 'Sync failed');
    return null;
  } finally {
    pushInFlight = false;
    useAuthStore.getState().setSyncing(false);

    if (pushQueued) {
      pushQueued = false;
      scheduleSync(250);
    }
  }
}

async function syncAfterLogin(user: AuthUser): Promise<void> {
  const local = usePlayerStore.getState();
  const server = await fetchServerLibrary();

  if (!server) {
    // Keep local data and retry through the normal debounced sync path.
    useAuthStore.getState().setSyncError('Could not load your cloud library yet.');
    usePlayerStore.getState().setOwnerId(user.id);
    useAuthStore.getState().setReady(true);
    return;
  }

  const localHasData = local.tracks.length > 0 || local.playlists.length > 0;
  const differentOwner = Boolean(local.ownerId && local.ownerId !== user.id);
  const serverHasData = server.tracks.length > 0 || server.playlists.length > 0;

  if (differentOwner || !localHasData) {
    // Fresh device, new empty account, or another account's local data.
    applyingRemote = true;
    usePlayerStore
      .getState()
      .replaceLibrary(server.tracks, server.playlists, user.id, server.updatedAt);
    applyingRemote = false;
    useAuthStore.getState().setLastSyncAt(server.updatedAt);
  } else if (!local.ownerId && localHasData) {
    // Guest library -> merge it into the account that just signed in.
    await pushLibrary(true);
  } else if (local.libraryUpdatedAt > server.updatedAt) {
    // This device has newer offline edits.
    await pushLibrary(false);
  } else if (serverHasData) {
    // Another device is ahead of us.
    applyingRemote = true;
    usePlayerStore
      .getState()
      .replaceLibrary(server.tracks, server.playlists, user.id, server.updatedAt);
    applyingRemote = false;
    useAuthStore.getState().setLastSyncAt(server.updatedAt);
  } else {
    usePlayerStore.getState().setOwnerId(user.id);
    useAuthStore.getState().setLastSyncAt(server.updatedAt);
  }

  useAuthStore.getState().setReady(true);
}

function scheduleSync(delay = 900): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (!useAuthStore.getState().user) return;
    void pushLibrary(false);
  }, delay);
}

export function startLibrarySync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  usePlayerStore.subscribe((state, previous) => {
    if (applyingRemote) return;
    if (state.tracks === previous.tracks && state.playlists === previous.playlists) {
      return;
    }

    const auth = useAuthStore.getState();
    if (!auth.ready || !auth.user) return;

    dirty = true;
    scheduleSync();
  });

  window.addEventListener('online', () => {
    if (useAuthStore.getState().user) void syncNow();
  });

  window.addEventListener('pagehide', () => {
    if (!dirty || !useAuthStore.getState().user) return;
    void pushLibrary(false, true);
  });
}

export function bootstrapSession(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (bootstrapped) return bootstrapped;

  bootstrapped = (async () => {
    const auth = useAuthStore.getState();
    auth.setLoading(true);

    try {
      const res = await apiFetch('/api/auth/me', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await readJson<{ user: AuthUser | null }>(res);

      if (!res.ok || !data?.user) {
        // Do not clobber a user set by a login form that completed while this
        // bootstrap request was still in flight.
        if (!useAuthStore.getState().user) {
          auth.setUser(null);
          auth.setReady(true);
        }
        auth.setLoading(false);
        return;
      }

      auth.setUser(data.user);
      auth.setLoading(false);
      await syncAfterLogin(data.user);
    } catch (err) {
      auth.setSyncError(
        err instanceof Error ? err.message : 'Could not read the local account database.'
      );
      auth.setReady(true);
      auth.setLoading(false);
    }
  })();

  return bootstrapped;
}

/** Called by the login/register screen after a successful password+2FA flow. */
export async function afterLogin(user: AuthUser): Promise<void> {
  const auth = useAuthStore.getState();
  auth.setUser(user);
  auth.setLoading(false);
  auth.setReady(false);
  await syncAfterLogin(user);
}

export async function syncNow(): Promise<void> {
  if (!useAuthStore.getState().user) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await pushLibrary(false);
}

export async function logout(allDevices = false): Promise<void> {
  try {
    await apiFetch(`/api/auth/logout${allDevices ? '?all=1' : ''}`, {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    /* best effort */
  }

  useAuthStore.getState().reset();
  applyingRemote = true;
  usePlayerStore.getState().replaceLibrary([], [], null, 0);
  applyingRemote = false;
  dirty = false;
}
