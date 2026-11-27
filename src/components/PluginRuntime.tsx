'use client';

// AURORA_PATCH: community plugin lifecycle host v2 - sandboxed iframe.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunityPlugin, Track } from '@/types';
import {
  createPluginFrameDocument,
  pluginStoragePrefix,
  safePluginStorageKey,
  MAX_PLUGIN_STORAGE_VALUE_LENGTH,
} from '@/lib/pluginSandbox';
import { apiReadCommunityPlugin } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { usePlayerStore } from '@/store/usePlayerStore';
import { usePluginStore } from '@/store/usePluginStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useToastStore } from '@/store/useToastStore';

const CHANNEL = 'aurora-plugin';

function snapshotTrack(): Track | null {
  const track = usePlayerStore.getState().currentTrack;
  return track ? { ...track } : null;
}

function readStorage(pluginId: string): Record<string, string> {
  const prefix = pluginStoragePrefix(pluginId);
  const values: Record<string, string> = {};

  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const value = window.localStorage.getItem(key);
      if (value !== null) values[key.slice(prefix.length)] = value;
    }
  } catch {
    // localStorage may be unavailable; plugins still run with empty state.
  }

  return values;
}

function CommunityPluginRunner({ plugin }: { plugin: CommunityPlugin }) {
  const { id, name } = plugin;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceRef = useRef<string | null>(null);
  const frameReadyRef = useRef(false);
  const loadSentRef = useRef(false);
  const [documentHtml] = useState(() => createPluginFrameDocument(id));
  const showToast = useToastStore((state) => state.showToast);

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame) return;
      frame.postMessage({ channel: CHANNEL, pluginId: id, ...message }, '*');
    },
    [id]
  );

  const sendLoad = useCallback(() => {
    if (loadSentRef.current) return;
    const source = sourceRef.current;
    if (!source || !frameReadyRef.current) return;
    loadSentRef.current = true;
    postToFrame({
      type: 'load',
      source,
      track: snapshotTrack(),
      storage: readStorage(id),
    });
  }, [id, postToFrame]);

  useEffect(() => {
    let cancelled = false;

    apiReadCommunityPlugin(id)
      .then((result) => {
        if (cancelled) return;
        sourceRef.current = result.source;
        sendLoad();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Unknown plugin error.';
        showToast(`Plugin "${name}" failed to load: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [id, name, sendLoad, showToast]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.channel !== CHANNEL || data.pluginId !== id) return;

      const type = String(data.type ?? '');
      const player = usePlayerStore.getState;

      switch (type) {
        case 'player.play':
          player().play();
          break;
        case 'player.pause':
          player().pause();
          break;
        case 'player.next':
          player().next();
          break;
        case 'ui.showToast': {
          const message = String(data.message ?? '').trim().slice(0, 500);
          if (message) showToast(message);
          break;
        }
        case 'storage.set': {
          const key = safePluginStorageKey(data.key);
          if (!key) break;
          const value = typeof data.value === 'string' ? data.value : '';
          if (value.length > MAX_PLUGIN_STORAGE_VALUE_LENGTH) break;
          try {
            window.localStorage.setItem(
              `${pluginStoragePrefix(id)}${key}`,
              value
            );
          } catch {
            // Storage quota or disabled storage: ignore.
          }
          break;
        }
        case 'error': {
          const message = String(data.message ?? 'Unknown plugin error.');
          showToast(`Plugin "${name}" failed to start: ${message}`);
          break;
        }
        case 'frame-ready':
          frameReadyRef.current = true;
          sendLoad();
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', onMessage);

    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      if (state.currentTrack === previous.currentTrack) return;
      postToFrame({ type: 'track', track: state.currentTrack });
    });

    return () => {
      window.removeEventListener('message', onMessage);
      unsubscribe();
      postToFrame({ type: 'shutdown' });
    };
  }, [id, name, postToFrame, sendLoad, showToast]);

  return (
    <iframe
      ref={frameRef}
      title={`Aurora plugin ${name}`}
      sandbox="allow-scripts"
      srcDoc={documentHtml}
      style={{ display: 'none' }}
      onLoad={() => {
        frameReadyRef.current = true;
        sendLoad();
      }}
    />
  );
}

// AURORA_FIX_PLUGIN_RUNTIME_STARTUP_V1
export function PluginRuntime() {
  const user = useAuthStore((state) => state.user);
  const authReady = useAuthStore((state) => state.ready);
  const userId = user?.id ?? null;
  const uploadedPlugins = usePluginStore((state) => state.uploadedPlugins);
  const communityPlugins = useSettingsStore(
    (state) => state.communityPlugins
  );
  const profileHydratedUserId = useSettingsStore(
    (state) => state.profileHydratedUserId
  );

  useEffect(() => {
    if (!authReady || !userId) return;
    void usePluginStore.getState().fetchPlugins();
  }, [authReady, userId]);

  if (!user || profileHydratedUserId !== user.id) return null;

  const enabledPlugins = uploadedPlugins.filter(
    (plugin) => communityPlugins[plugin.id] ?? plugin.enabled
  );

  return (
    <>
      {enabledPlugins.map((plugin) => (
        <CommunityPluginRunner key={plugin.id} plugin={plugin} />
      ))}
    </>
  );
}
