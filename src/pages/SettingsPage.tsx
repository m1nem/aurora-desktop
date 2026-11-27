// AURORA_PATCH: Settings page v5 - native IPC diagnostics, migration and media tools
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { syncNow } from '@/lib/librarySync';
// AURORA_FIX_SETTINGS_PAGE_V1
import {
  apiAudioIntegrationStatus,
  apiRestoreDefaultMusicPlayer,
  apiSetDefaultMusicPlayer,
  apiYtDlpStatus,
  type AudioIntegrationStatus,
  type YtDlpStatus,
} from '@/lib/api';
import { themeById } from '@/lib/themes';
import { Button } from '@/components/ui/Button';
import {
  checkBridgeStatus,
  probeDiscordConnection,
  type BridgeStatus,
} from '@/lib/discordClient';
import {
  DEFAULT_DISCORD_APP_ID,
  isValidDiscordAppId,
} from '@/lib/discordConfig';

export default function SettingsPage() {
  const clearLibrary = usePlayerStore((s) => s.clearLibrary);

  const user = useAuthStore((s) => s.user);
  const syncing = useAuthStore((s) => s.syncing);
  const lastSyncAt = useAuthStore((s) => s.lastSyncAt);
  const syncError = useAuthStore((s) => s.syncError);

  const discordEnabled = useSettingsStore((s) => s.discordEnabled);
  const discordMode = useSettingsStore((s) => s.discordMode);
  const discordCustomAppId = useSettingsStore((s) => s.discordCustomAppId);
  const discordAppId = useSettingsStore((s) => s.discordAppId);
  const theme = useSettingsStore((s) => s.theme);
  const setDiscordEnabled = useSettingsStore((s) => s.setDiscordEnabled);
  const setDiscordMode = useSettingsStore((s) => s.setDiscordMode);
  const setDiscordCustomAppId = useSettingsStore((s) => s.setDiscordCustomAppId);
  const reset = useSettingsStore((s) => s.reset);

  const [appIdDraft, setAppIdDraft] = useState(discordCustomAppId);
  const [appIdError, setAppIdError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [checkingBridge, setCheckingBridge] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [ytdlpStatus, setYtdlpStatus] = useState<YtDlpStatus | null>(null);
  const [integration, setIntegration] = useState<AudioIntegrationStatus | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationMessage, setIntegrationMessage] = useState<string | null>(null);

  const activeTheme = themeById(theme);

  const refreshBridgeStatus = async () => {
    setCheckingBridge(true);
    const status = await probeDiscordConnection(
      discordAppId || DEFAULT_DISCORD_APP_ID
    );
    setBridgeStatus(status);
    setCheckingBridge(false);
  };

  useEffect(() => {
    let cancelled = false;

    checkBridgeStatus().then((status) => {
      if (cancelled) return;
      setBridgeStatus(status);
      setCheckingBridge(false);
    });
    apiAudioIntegrationStatus()
      .then((status) => {
        if (!cancelled) setIntegration(status);
      })
      .catch(() => {
        if (!cancelled) setIntegration(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveAppId = () => {
    const trimmed = appIdDraft.trim();

    if (trimmed && !isValidDiscordAppId(trimmed)) {
      setAppIdError('The Discord Application ID must be 17 to 20 digits.');
      return;
    }

    setAppIdError(null);
    setDiscordCustomAppId(trimmed || DEFAULT_DISCORD_APP_ID);
    setDiscordMode('custom');
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const handleClearLibrary = () => {
    if (
      confirm(
        user
          ? 'WARNING: This removes all tracks and playlists from this device AND your synced account. Continue?'
          : 'WARNING: This will remove all local tracks and playlists from storage. Continue?'
      )
    ) {
      clearLibrary();
    }
  };

  const handleSyncNow = async () => {
    setSyncingNow(true);
    await syncNow();
    setSyncingNow(false);
  };

  const handleSetDefaultPlayer = async () => {
    setIntegrationBusy(true);
    setIntegrationMessage(null);
    try {
      const status = await apiSetDefaultMusicPlayer();
      setIntegration(status);
      const handler = status.defaults.find((item) => item.mime === 'audio/mpeg');
      setIntegrationMessage(
        handler?.desktopFile === 'auroramp.desktop'
          ? 'AuroraMP is now the default handler for supported audio files.'
          : `xdg-mime reports: ${handler?.desktopFile ?? 'no handler'}.`
      );
    } catch (error) {
      setIntegrationMessage(
        error instanceof Error ? error.message : 'Could not update the default player.'
      );
    } finally {
      setIntegrationBusy(false);
    }
  };

  const handleRestoreDefaultPlayer = async () => {
    setIntegrationBusy(true);
    setIntegrationMessage(null);
    try {
      const status = await apiRestoreDefaultMusicPlayer();
      setIntegration(status);
      setIntegrationMessage('Restored previous system audio associations.');
    } catch (error) {
      setIntegrationMessage(
        error instanceof Error ? error.message : 'Could not restore previous audio associations.'
      );
    } finally {
      setIntegrationBusy(false);
    }
  };

  const handleCheckYtDlp = async () => {
    setYtdlpBusy(true);
    try {
      setYtdlpStatus(await apiYtDlpStatus());
    } catch (error) {
      setYtdlpStatus({
        available: false,
        source: null,
        version: null,
        error:
          error instanceof Error ? error.message : 'yt-dlp check failed.',
      });
    } finally {
      setYtdlpBusy(false);
    }
  };

  const handleReset = () => {
    if (confirm('Reset all settings to defaults?')) {
      reset();
      setAppIdDraft(DEFAULT_DISCORD_APP_ID);
      setAppIdError(null);
    }
  };

  const bridgeLabel = checkingBridge
    ? 'Checking...'
    : bridgeStatus?.ok
      ? bridgeStatus.ready
        ? 'Connected'
        : 'Bridge online, Discord offline'
      : 'Offline';

  return (
    <div className="space-y-5 font-mono text-xs max-w-3xl">
      {/* Settings Header */}
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h1 className="text-base font-bold text-[var(--term-text-bright)]">
          Settings
        </h1>
        <p className="text-[var(--term-text-muted)] text-xs mt-1 leading-relaxed">
          Configure appearance theme, Discord Rich Presence integration, and storage.
        </p>
      </div>

      {/* Appearance lives in the Marketplace */}
      <section className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--term-border)] pb-2">
          <span className="font-semibold text-sm text-[var(--term-text-bright)]">
            Appearance &amp; Plugins
          </span>
          <span className="text-xs text-[var(--term-border-bright)]">
            Active: {activeTheme.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTheme.swatches.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className="h-5 w-10 border border-[var(--term-border)]"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          ))}
        </div>

        <p className="text-xs leading-relaxed text-[var(--term-text-muted)]">
          Theme galleries, plugin toggles, player colors, font size and the raw
          custom CSS editor have moved to the Marketplace.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/marketplace?tab=themes"
            className="border border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] px-3 py-1.5 font-semibold text-[var(--term-invert-text)]"
          >
            [ Open Themes ]
          </Link>
          <Link
            href="/marketplace"
            className="border border-[var(--term-border)] px-3 py-1.5 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            [ Manage Plugins ]
          </Link>
          <Link
            href="/developers"
            className="border border-[var(--term-border)] px-3 py-1.5 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            [ Developer Docs ]
          </Link>
        </div>
      </section>

      {/* Discord RPC */}
      <section className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--term-border)] pb-2">
          <span className="font-semibold text-sm text-[var(--term-text-bright)]">
            Discord Rich Presence
          </span>
          <span className="text-xs text-[var(--term-text-muted)]">
            Status: {discordEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 py-1">
          <div>
            <div className="text-xs text-[var(--term-text-bright)]">
              Broadcast playing track
            </div>
            <p className="text-xs text-[var(--term-text-muted)] mt-0.5">
              Show the current track, artist, live progress, and action buttons on your Discord profile.
            </p>
          </div>
          <button
            onClick={() => setDiscordEnabled(!discordEnabled)}
            className={`px-3 py-1 border text-xs font-semibold transition-none ${
              discordEnabled
                ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)]'
                : 'border-[var(--term-border)] text-[var(--term-text-muted)] hover:text-white'
            }`}
          >
            {discordEnabled ? '[ Enabled ]' : '[ Disabled ]'}
          </button>
        </div>

        <div className="space-y-2 border-t border-[var(--term-border)] pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--term-text-muted)]">
              Application mode:
            </span>
            <button
              type="button"
              onClick={() => {
                setDiscordMode('default');
                setAppIdError(null);
              }}
              className={`border px-2.5 py-1 text-[11px] font-semibold ${
                discordMode === 'default'
                  ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)]'
                  : 'border-[var(--term-border)] text-[var(--term-text-muted)]'
              }`}
            >
              [ DEFAULT AURORA CLIENT ]
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscordMode('custom');
                setAppIdDraft(discordCustomAppId);
              }}
              className={`border px-2.5 py-1 text-[11px] font-semibold ${
                discordMode === 'custom'
                  ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)]'
                  : 'border-[var(--term-border)] text-[var(--term-text-muted)]'
              }`}
            >
              [ CUSTOM CLIENT ]
            </button>
          </div>

          <label htmlFor="app-id" className="block text-xs text-[var(--term-text-muted)]">
            {discordMode === 'default' ? 'Default Aurora Client ID' : 'Custom Client ID'}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="app-id"
              value={discordMode === 'default' ? DEFAULT_DISCORD_APP_ID : appIdDraft}
              onChange={(e) => {
                setAppIdDraft(e.target.value);
                if (appIdError) setAppIdError(null);
              }}
              readOnly={discordMode === 'default'}
              disabled={discordMode === 'default'}
              placeholder={DEFAULT_DISCORD_APP_ID}
              className="h-9 flex-1 rounded-none border border-[var(--term-border)] bg-[var(--term-bg-input)] px-3 text-xs text-[var(--term-text-bright)] placeholder:text-[var(--term-text-dim)] focus:border-[var(--term-border-bright)] focus:outline-none disabled:opacity-60"
            />
            {discordMode === 'custom' && (
              <Button variant="primary" size="md" onClick={handleSaveAppId}>
                {savedFlash ? '[ Saved! ]' : '[ Save ID ]'}
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--term-text-dim)]">
            {discordMode === 'default'
              ? 'The fixed Aurora client ID is locked to prevent accidental edits. Rich Presence is enabled by default.'
              : 'Use a custom Discord application ID (17–20 digits). Invalid IDs fall back to the Aurora client.'}
          </p>
          {appIdError && (
            <p className="border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-400">
              {appIdError}
            </p>
          )}
        </div>
      </section>

      {/* Native Discord IPC diagnostics */}
      <section className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--term-border)] pb-2">
          <span className="font-semibold text-sm text-[var(--term-text-bright)]">
            Discord IPC
          </span>
          <span
            className={`text-xs ${
              bridgeStatus?.ok && bridgeStatus.ready
                ? 'text-[var(--term-border-bright)]'
                : 'text-[var(--term-text-muted)]'
            }`}
          >
            Status: {bridgeLabel}
          </span>
        </div>

        <p className="text-xs text-[var(--term-text-muted)] leading-relaxed">
          Aurora talks to the Discord desktop client directly over its local IPC
          socket. No bridge daemon or extra command is required. Start the
          Discord desktop app on this computer and leave Rich Presence enabled
          above.
        </p>

        <div className="border border-[var(--term-border)] bg-[var(--term-bg-input)] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--term-text-muted)]">Transport:</span>
            <code className="text-[var(--term-text-bright)]">Unix socket (discord-ipc-*)</code>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--term-text-muted)]">App ID:</span>
            <code className="text-[var(--term-border-bright)]">
              {bridgeStatus?.appId || discordAppId || DEFAULT_DISCORD_APP_ID}
            </code>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--term-text-muted)]">Activity type:</span>
            <span className="text-[var(--term-text-bright)]">Listening (2)</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="primary"
            size="md"
            onClick={refreshBridgeStatus}
            disabled={checkingBridge}
          >
            {checkingBridge ? '[ Checking... ]' : '[ Test Connection ]'}
          </Button>
          <span className="text-[11px] text-[var(--term-text-dim)]">
            Discord desktop must be running.
          </span>
        </div>

        {bridgeStatus?.error && (
          <p className="text-[11px] text-amber-300 border border-amber-900 bg-amber-950/30 px-2 py-1">
            Discord IPC unavailable: {bridgeStatus.error}
          </p>
        )}

        <p className="text-[11px] text-[var(--term-text-dim)] leading-relaxed border-t border-[var(--term-border)] pt-2">
          Note: Discord&apos;s desktop client may hide buttons on your own profile
          popout. They are still sent to Discord and are visible to other users and
          on mobile clients. Upload the <code>auroramp_logo</code> and{' '}
          <code>aurora_logo</code> Rich Presence assets in the Discord Developer
          Portal if the images do not appear.
        </p>
      </section>

      {/* Media dependencies */}
      <section className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--term-border)] pb-2">
          <span className="font-semibold text-sm text-[var(--term-text-bright)]">
            Media Dependencies
          </span>
          <span
            className={`text-xs ${
              ytdlpStatus?.available
                ? 'text-[var(--term-border-bright)]'
                : 'text-[var(--term-text-muted)]'
            }`}
          >
            {ytdlpStatus
              ? ytdlpStatus.available
                ? 'yt-dlp ready'
                : 'yt-dlp missing'
              : 'Not checked'}
          </span>
        </div>

        <p className="text-xs text-[var(--term-text-muted)] leading-relaxed">
          YouTube search uses YouTube Music directly. Downloads require the
          external <code className="text-[var(--term-border-bright)]">yt-dlp</code>{' '}
          and <code className="text-[var(--term-border-bright)]">ffmpeg</code>{' '}
          binaries. Aurora looks for yt-dlp on PATH, in its own data directory,
          as a Python module, and finally downloads a standalone build.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handleCheckYtDlp}
            disabled={ytdlpBusy}
          >
            {ytdlpBusy ? '[ Checking... ]' : '[ Check yt-dlp ]'}
          </Button>
          {ytdlpStatus && (
            <span className="text-[11px] text-[var(--term-text-dim)]">
              {ytdlpStatus.available
                ? `${ytdlpStatus.source ?? 'found'}${ytdlpStatus.version ? ` · ${ytdlpStatus.version}` : ''}`
                : ytdlpStatus.error}
            </span>
          )}
        </div>
      </section>

      {/* Linux desktop integration */}
      <section className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--term-border)] pb-2">
          <span className="font-semibold text-sm text-[var(--term-text-bright)]">
            Linux Desktop Integration
          </span>
          <span className="text-xs text-[var(--term-text-muted)]">
            {integration ? `${integration.supportedMimeTypes.length} MIME types` : 'Checking...'}
          </span>
        </div>

        <p className="text-xs leading-relaxed text-[var(--term-text-muted)]">
          AuroraMP can be registered as the handler for MP3, OGG, FLAC, WAV,
          M4A, AAC, Opus and WebM audio. File associations are installed with the
          package; this action also writes a user desktop entry and uses
          <code className="mx-1 text-[var(--term-border-bright)]">xdg-mime</code>
          to make AuroraMP the default. On Wayland/COSMIC the file manager may
          require a re-login before it refreshes its associations.
        </p>

        {integration && (
          <div className="space-y-1 border border-[var(--term-border)] bg-[var(--term-bg-input)] p-2.5 text-[11px]">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--term-text-muted)]">Desktop entry:</span>
              <code className="truncate text-[var(--term-text-bright)]">
                {integration.desktopFile}
              </code>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--term-text-muted)]">Current MP3 handler:</span>
              <code className="text-[var(--term-border-bright)]">
                {integration.defaults.find((item) => item.mime === 'audio/mpeg')?.desktopFile ?? 'none'}
              </code>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--term-text-muted)]">Supported:</span>
              <span className="text-[var(--term-text-bright)]">
                {integration.supportedExtensions.join(', ')}
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handleSetDefaultPlayer}
            disabled={integrationBusy}
          >
            {integrationBusy ? '[ Updating... ]' : '[ Set as Default Music Player ]'}
          </Button>
          {integration?.canRestoreDefaults && (
            <Button
              variant="glass"
              size="md"
              onClick={handleRestoreDefaultPlayer}
              disabled={integrationBusy}
            >
              [ Restore Previous Associations ]
            </Button>
          )}
          <span className="text-[11px] text-[var(--term-text-dim)]">
            Uses xdg-mime and backs up previous associations so they can be restored safely.
          </span>
        </div>

        {integrationMessage && (
          <p className="border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2 py-1 text-[11px] leading-relaxed text-[var(--term-text-muted)]">
            {integrationMessage}
          </p>
        )}
      </section>

      {/* Storage & Reset */}
      <section className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 space-y-3">
        <div className="border-b border-[var(--term-border)] pb-2">
          <span className="font-semibold text-sm text-[var(--term-text-bright)]">
            Storage & Maintenance
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="danger" size="md" onClick={handleClearLibrary}>
            [ Wipe Library &amp; Playlists ]
          </Button>
          <Button variant="glass" size="md" onClick={handleReset}>
            [ Reset All Settings ]
          </Button>
        </div>
      </section>
    </div>
  );
}
