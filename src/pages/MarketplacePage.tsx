import { openExternalUrl } from '@/lib/externalLink';
const DISCORD_INVITE_URL = 'https://discord.gg/GTDb58kMGK';

// AURORA_PATCH: Marketplace v1 - plugins, themes, custom CSS and player palette
'use client';

import { Suspense, useState } from 'react';
import { apiFetch } from '@/lib/api';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { usePluginStore } from '@/store/usePluginStore';
import { useToastStore } from '@/store/useToastStore';
import {
  PLUGIN_CATALOG,
  type PluginManifest,
} from '@/lib/plugins';
import {
  THEMES,
  customizationForTheme,
  themeById,
} from '@/lib/themes';
import { WipBadge, WipBanner } from '@/components/WipBadge';
import { UploadPluginModal } from '@/components/UploadPluginModal';
import type { CommunityPlugin } from '@/types';
import { cn } from '@/lib/utils';

type MarketplaceTab = 'plugins' | 'themes';

function ToggleSwitch({
  checked,
  onChange,
  label,
  danger = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // 48x24 track: 1px border + 3px padding leaves a 40x16 content box,
        // so the 16x16 thumb fits exactly and can travel exactly 24px (translate-x-6).
        'inline-flex h-6 w-12 shrink-0 items-center overflow-hidden border p-[3px] transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--term-border-bright)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--term-bg-panel)] disabled:cursor-not-allowed disabled:opacity-40',
        checked
          ? danger
            ? 'border-red-500 bg-red-600'
            : 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)]'
          : 'border-[var(--term-border)] bg-[var(--term-bg-input)] hover:border-[var(--term-border-bright)]'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-4 w-4 shrink-0 transition-all duration-200 ease-in-out',
          checked
            ? 'translate-x-6'
            : 'translate-x-0',
          checked
            ? danger
              ? 'bg-white'
              : 'bg-[var(--term-invert-text)]'
            : 'bg-[var(--term-text-dim)]'
        )}
      />
    </button>
  );
}

function PluginCard({
  plugin,
  enabled,
  onToggle,
}: {
  plugin: PluginManifest;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const isWip = plugin.wip;

  return (
    <article
      className={cn(
        'space-y-3 border p-4',
        isWip
          ? 'border-red-900 bg-red-950/20'
          : 'border-[var(--term-border)] bg-[var(--term-bg-panel)]'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className={cn(
                'text-sm font-semibold',
                isWip ? 'text-red-200' : 'text-[var(--term-text-bright)]'
              )}
            >
              {plugin.name}
            </h2>
            {isWip && <WipBadge />}
            <span className="border border-[var(--term-border)] px-1.5 py-0.5 text-[10px] text-[var(--term-text-dim)]">
              v{plugin.version}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-[var(--term-text-muted)]">
            {plugin.description}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              'whitespace-nowrap text-[10px] font-semibold leading-none',
              enabled
                ? isWip
                  ? 'text-red-300'
                  : 'text-[var(--term-border-bright)]'
                : 'text-[var(--term-text-dim)]'
            )}
          >
            {enabled ? '[ ENABLED ]' : '[ DISABLED ]'}
          </span>
          <ToggleSwitch
            checked={enabled}
            onChange={onToggle}
            label={`${enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
            danger={isWip}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--term-border)] pt-2 text-[10px] text-[var(--term-text-dim)]">
        <span>author: {plugin.author}</span>
        <span>id: {plugin.id}</span>
        <span>default: {plugin.defaultEnabled ? 'on' : 'off'}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {plugin.capabilities.map((capability) => (
          <span
            key={capability}
            className="border border-[var(--term-border)] bg-[var(--term-bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--term-text-muted)]"
          >
            {capability}
          </span>
        ))}
      </div>

      {isWip && (
        <p className="border-t border-red-900/60 pt-2 text-[11px] leading-relaxed text-red-300">
          {enabled
            ? 'JAM is enabled. Session creation, room joins and Discord Listen Along links are available while this feature remains WIP.'
            : 'Toggling JAM on exposes the experimental session buttons and Listen Along rooms. The feature remains usable despite the WIP label.'}
        </p>
      )}
    </article>
  );
}

function CommunityPluginCard({
  plugin,
  enabled,
  canToggle,
  deleting,
  onToggle,
  onDelete,
}: {
  plugin: CommunityPlugin;
  enabled: boolean;
  canToggle: boolean;
  deleting: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <article className="space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold text-[var(--term-text-bright)]">
              {plugin.name}
            </h3>
            <span className="border border-[var(--term-border-bright)] px-1.5 py-0.5 text-[10px] text-[var(--term-border-bright)]">
              [ COMMUNITY ]
            </span>
            <span className="border border-[var(--term-border)] px-1.5 py-0.5 text-[10px] text-[var(--term-text-dim)]">
              v{plugin.version}
            </span>
          </div>
          <p className="break-words text-xs leading-relaxed text-[var(--term-text-muted)]">
            {plugin.description || 'No description provided.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              'whitespace-nowrap text-[10px] font-semibold leading-none',
              enabled
                ? 'text-[var(--term-border-bright)]'
                : 'text-[var(--term-text-dim)]'
            )}
          >
            {!canToggle
              ? '[ SIGN IN TO ENABLE ]'
              : enabled
                ? '[ ENABLED ]'
                : '[ DISABLED ]'}
          </span>
          <ToggleSwitch
            checked={enabled}
            onChange={onToggle}
            label={`${enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
            disabled={!canToggle}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--term-border)] pt-2 text-[10px] text-[var(--term-text-dim)]">
        <span>author: {plugin.author}</span>
        <span>owner: @{plugin.ownerName}</span>
        <span className="break-all">id: {plugin.id}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--term-border)] pt-2">
        <span className="text-[10px] leading-relaxed text-[var(--term-text-dim)]">
          Uploaded JavaScript · restricted host API · isolated iframe
        </span>
        {plugin.canDelete && canToggle ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="border border-red-900 px-2.5 py-1 text-[10px] text-red-300 hover:border-red-500 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? '[ DELETING... ]' : '[ DELETE ]'}
          </button>
        ) : (
          <span className="text-[10px] text-[var(--term-text-dim)]">
            [ READ ONLY ]
          </span>
        )}
      </div>
    </article>
  );
}

function MarketplaceContent() {
  const searchParams = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const plugins = useSettingsStore((state) => state.plugins);
  const setPlugin = useSettingsStore((state) => state.setPlugin);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const customCss = useSettingsStore((state) => state.customCss);
  const setCustomCss = useSettingsStore((state) => state.setCustomCss);
  const playerCustomization = useSettingsStore(
    (state) => state.playerCustomization
  );
  const setPlayerCustomization = useSettingsStore(
    (state) => state.setPlayerCustomization
  );
  const communityPlugins = useSettingsStore(
    (state) => state.communityPlugins
  );
  const setCommunityPlugin = useSettingsStore(
    (state) => state.setCommunityPlugin
  );
  const removeCommunityPlugin = useSettingsStore(
    (state) => state.removeCommunityPlugin
  );
  const uploadedPlugins = usePluginStore((state) => state.uploadedPlugins);
  const pluginsLoading = usePluginStore((state) => state.loading);
  const pluginsError = usePluginStore((state) => state.error);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);
  const removePlugin = usePluginStore((state) => state.removePlugin);
  const showToast = useToastStore((state) => state.showToast);

  const [tab, setTab] = useState<MarketplaceTab>(() =>
    searchParams.get('tab') === 'themes' ? 'themes' : 'plugins'
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingPluginId, setDeletingPluginId] = useState<string | null>(null);

  const activeTheme = themeById(theme);

  const deleteCommunityPlugin = async (plugin: CommunityPlugin) => {
    if (!user || deletingPluginId) return;
    if (
      !window.confirm(
        `Delete plugin "${plugin.name}"? This removes the file and cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingPluginId(plugin.id);
    try {
      const response = await apiFetch(
        `/api/marketplace/plugins/${encodeURIComponent(plugin.id)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : `Delete failed (${response.status}).`
        );
      }

      removePlugin(plugin.id);
      removeCommunityPlugin(plugin.id);
      showToast(`Plugin "${plugin.name}" deleted.`);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to delete plugin.'
      );
    } finally {
      setDeletingPluginId(null);
    }
  };

  const selectTab = (next: MarketplaceTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 font-mono text-xs">
      <header className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--term-text-dim)]">
              AuroraMP / Marketplace
            </div>
            <h1 className="mt-1 text-lg font-bold text-[var(--term-text-bright)]">
              Marketplace
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--term-text-muted)]">
              Enable feature plugins, install visual themes, inject custom CSS,
              and tune the player palette. Preferences are saved locally and to
              your account profile when signed in.
            </p>
          </div>
          <Link
            href="/developers"
            className="border border-[var(--term-border)] px-3 py-1.5 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            [ DEVELOPER DOCS ]
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--term-border)] pt-3 text-[11px]">
          <span className="text-[var(--term-text-dim)]">
            {user
              ? `Signed in as @${user.username} — changes are stored in your local profile.`
              : 'Guest mode — changes are stored in this browser only. Sign in to sync.'}
          </span>
          <span className="text-[var(--term-border-bright)]">
            Active theme: {activeTheme.name}
          </span>
        </div>
      </header>

      <div className="flex border-b border-[var(--term-border)]">
        {([
          ['plugins', 'PLUGINS'],
          ['themes', 'THEMES'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            className={cn(
              'border border-b-0 px-4 py-2 font-semibold',
              tab === id
                ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)]'
                : 'border-[var(--term-border)] bg-[var(--term-bg-panel)] text-[var(--term-text-muted)] hover:text-[var(--term-text-bright)]'
            )}
          >
            [ {label} ]
          </button>
        ))}
      </div>

      {tab === 'plugins' ? (
        <div className="space-y-4">
          <WipBanner>
            JAM Session is marked as WIP. It remains fully usable when enabled,
            including creating and joining rooms and Discord Listen Along links.
            Email 2FA enrollment is separately disabled in Account settings while
            that flow is finished.
          </WipBanner>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--term-text-bright)]">
              Available Plugins
            </h2>
            <span className="text-[10px] text-[var(--term-text-dim)]">
              {PLUGIN_CATALOG.filter((plugin) => plugins[plugin.id]).length} of{' '}
              {PLUGIN_CATALOG.length} enabled
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {PLUGIN_CATALOG.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                enabled={plugins[plugin.id]}
                onToggle={(enabled) => setPlugin(plugin.id, enabled)}
              />
            ))}
          </div>

          <section className="space-y-3 border-t border-[var(--term-border)] pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--term-text-bright)]">
                  Community Plugins
                </h2>
                <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--term-text-muted)]">
                  Uploaded JavaScript plugins are stored in the desktop app data
                  directory and run inside an isolated sandboxed iframe through
                  a restricted host API. Only enable plugins from trusted sources.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--term-text-dim)]">
                  {uploadedPlugins.length} uploaded
                  {pluginsLoading ? ' · loading...' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void openExternalUrl(DISCORD_INVITE_URL)}
                  className="border border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] px-3 py-1.5 text-[10px] font-semibold text-[var(--term-invert-text)]"
                >
                  [ SUBMIT ON DISCORD ]
                </button>
              </div>
            </div>

            {pluginsError && (
              <div className="flex flex-wrap items-center justify-between gap-2 border border-red-900 bg-red-950/20 p-3 text-[11px] leading-relaxed text-red-200">
                <span>Failed to load community plugins: {pluginsError}</span>
                <button
                  type="button"
                  onClick={() => void fetchPlugins()}
                  className="border border-red-700 px-2 py-1 text-[10px] text-red-200 hover:border-red-400"
                >
                  [ RETRY ]
                </button>
              </div>
            )}

            {pluginsLoading && uploadedPlugins.length === 0 && (
              <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 text-[11px] text-[var(--term-text-muted)]">
                Loading community plugins...
              </div>
            )}

            {!pluginsLoading &&
              !pluginsError &&
              uploadedPlugins.length === 0 && (
                <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 text-[11px] leading-relaxed text-[var(--term-text-muted)]">
                  No community plugins installed yet. Join our Discord server (<a href="https://discord.gg/GTDb58kMGK" target="_blank" rel="noreferrer" className="text-[var(--term-border-bright)] underline">discord.gg/GTDb58kMGK</a>) to browse, share, and submit community plugins.
                </div>
              )}

            {uploadedPlugins.length > 0 && (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {uploadedPlugins.map((plugin) => (
                  <CommunityPluginCard
                    key={plugin.id}
                    plugin={plugin}
                    enabled={communityPlugins[plugin.id] ?? plugin.enabled}
                    canToggle={Boolean(user)}
                    deleting={deletingPluginId === plugin.id}
                    onToggle={(enabled) =>
                      setCommunityPlugin(plugin.id, enabled)
                    }
                    onDelete={() => void deleteCommunityPlugin(plugin)}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-3 text-[11px] leading-relaxed text-[var(--term-text-muted)]">
            Plugin flags are stored under{' '}
            <code className="text-[var(--term-border-bright)]">
              aurora-settings
            </code>{' '}
            in localStorage and in your profile through{' '}
            <code className="text-[var(--term-border-bright)]">
              PUT /api/preferences
            </code>
            . Community plugin enabled states live in{' '}
            <code className="text-[var(--term-border-bright)]">
              preferences.communityPlugins
            </code>
            . The public catalog is available from{' '}
            <code className="text-[var(--term-border-bright)]">
              GET /api/plugins
            </code>{' '}
            and{' '}
            <code className="text-[var(--term-border-bright)]">
              GET /api/marketplace/plugins
            </code>
            .
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--term-border)] pb-2">
              <h2 className="text-sm font-semibold text-[var(--term-text-bright)]">
                Theme Gallery
              </h2>
              <span className="text-[10px] text-[var(--term-text-dim)]">
                Click a card to apply it instantly
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {THEMES.map((preset) => {
                const selected = preset.id === theme;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setTheme(preset.id)}
                    className={cn(
                      'space-y-2 border p-3 text-left transition-none',
                      selected
                        ? 'border-[var(--term-border-bright)] bg-[var(--term-bg-hover)]'
                        : 'border-[var(--term-border)] bg-[var(--term-bg-input)] hover:border-[var(--term-border-bright)]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--term-text-bright)]">
                        {preset.name}
                      </span>
                      <span
                        className={cn(
                          'text-[10px]',
                          selected
                            ? 'text-[var(--term-border-bright)]'
                            : 'text-[var(--term-text-dim)]'
                        )}
                      >
                        {selected ? '[ ACTIVE ]' : '[ APPLY ]'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {preset.swatches.map((color, index) => (
                        <span
                          key={`${preset.id}-${index}`}
                          className="h-5 flex-1 border border-black/40"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--term-text-muted)]">
                      {preset.description}
                    </p>
                    <div className="flex gap-2 text-[10px] text-[var(--term-text-dim)]">
                      <span>{preset.background}</span>
                      <span>{preset.accent}</span>
                      <span>{preset.fontSize}px base</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--term-border)] pb-2">
              <h2 className="text-sm font-semibold text-[var(--term-text-bright)]">
                Player Customization
              </h2>
              <button
                type="button"
                onClick={() =>
                  setPlayerCustomization(customizationForTheme(theme))
                }
                className="border border-[var(--term-border)] px-2 py-1 text-[10px] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
              >
                [ RESET TO THEME ]
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="block text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                  Background
                </span>
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={playerCustomization.background}
                    onChange={(event) =>
                      setPlayerCustomization({
                        background: event.target.value,
                      })
                    }
                    className="h-8 w-12 cursor-pointer border border-[var(--term-border)] bg-transparent p-0.5"
                  />
                  <code className="text-[11px] text-[var(--term-text-muted)]">
                    {playerCustomization.background}
                  </code>
                </span>
              </label>

              <label className="space-y-1.5">
                <span className="block text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                  Accent
                </span>
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    value={playerCustomization.accentColor}
                    onChange={(event) =>
                      setPlayerCustomization({
                        accentColor: event.target.value,
                      })
                    }
                    className="h-8 w-12 cursor-pointer border border-[var(--term-border)] bg-transparent p-0.5"
                  />
                  <code className="text-[11px] text-[var(--term-text-muted)]">
                    {playerCustomization.accentColor}
                  </code>
                </span>
              </label>

              <label className="space-y-1.5">
                <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--term-text-dim)]">
                  <span>Base font size</span>
                  <span className="text-[var(--term-border-bright)]">
                    {playerCustomization.fontSize}px
                  </span>
                </span>
                <input
                  type="range"
                  min={12}
                  max={20}
                  step={1}
                  value={playerCustomization.fontSize}
                  onChange={(event) =>
                    setPlayerCustomization({
                      fontSize: Number(event.target.value),
                    })
                  }
                  className="w-full accent-[var(--term-border-bright)]"
                />
              </label>
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--term-text-dim)]">
              Background and accent colors re-derive panel, input, border and
              readable text colors automatically. Font size changes the root rem
              scale used by the terminal UI.
            </p>
          </section>

          <section className="space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--term-border)] pb-2">
              <h2 className="text-sm font-semibold text-[var(--term-text-bright)]">
                Custom CSS Editor
              </h2>
              <span className="text-[10px] text-[var(--term-text-dim)]">
                {customCss.length.toLocaleString()} / 50,000 chars · live
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-[var(--term-text-muted)]">
              Raw CSS is saved in your profile and localStorage, then injected
              live into the document head through{' '}
              <code className="text-[var(--term-border-bright)]">
                &lt;style id=&quot;aurora-custom-css&quot;&gt;
              </code>
              . Use the CSS variables documented in the developer docs.
            </p>

            <textarea
              value={customCss}
              onChange={(event) => setCustomCss(event.target.value)}
              spellCheck={false}
              rows={12}
              maxLength={50000}
              placeholder={`:root {\n  --term-border-bright: #38bdf8;\n}\n\n.player-shell {\n  border-width: 2px;\n}`}
              className="w-full resize-y border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 font-mono text-[11px] leading-relaxed text-[var(--term-text-bright)] outline-none placeholder:text-[var(--term-text-dim)] focus:border-[var(--term-border-bright)]"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCustomCss('')}
                className="border border-[var(--term-border)] px-3 py-1.5 text-[var(--term-text-muted)] hover:border-red-800 hover:text-red-300"
              >
                [ CLEAR ]
              </button>
              <span className="border border-[var(--term-border)] px-2 py-1 text-[10px] text-[var(--term-border-bright)]">
                [ SAVES LOCALLY + PROFILE ]
              </span>
              <Link
                href="/developers#css"
                className="text-[10px] text-[var(--term-text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--term-border-bright)]"
              >
                CSS reference
              </Link>
            </div>
          </section>
        </div>
      )}

      {uploadOpen && (
        <UploadPluginModal onClose={() => setUploadOpen(false)} />
      )}
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 font-mono text-xs text-[var(--term-text-muted)]">
          Loading Marketplace...
        </div>
      }
    >
      <MarketplaceContent />
    </Suspense>
  );
}
