// AURORA_PATCH: developer documentation v1 - CSS + plugin manifests
import Link from 'next/link';

const cssVariables = [
  ['--term-bg', 'Page and app background.'],
  ['--term-bg-panel', 'Panel and card background.'],
  ['--term-bg-input', 'Inputs, code blocks and inset surfaces.'],
  ['--term-bg-hover', 'Selected and hovered surfaces.'],
  ['--term-border', 'Default 1px border color.'],
  ['--term-border-bright', 'Accent border and active highlight.'],
  ['--term-text', 'Default body text.'],
  ['--term-text-bright', 'Headings and high-emphasis text.'],
  ['--term-text-muted', 'Secondary copy and descriptions.'],
  ['--term-text-dim', 'Tertiary labels and disabled text.'],
  ['--term-invert-bg', 'Inverted button background.'],
  ['--term-invert-text', 'Text on inverted surfaces.'],
  ['--term-accent', 'General accent color.'],
  ['--term-danger', 'Destructive and warning accent (red).'],
  ['--term-tag-bg', 'Tag and capability chip background.'],
  ['--term-selection-bg', 'Text selection background.'],
  ['--term-selection-text', 'Text selection foreground.'],
  ['--player-height', 'Measured height of the fixed player.'],
];

const classNames = [
  ['.app-main', 'Main scroll area; already accounts for the fixed player.'],
  ['.player-shell', 'Root container of the fixed bottom player.'],
  ['.glass', 'Low-opacity panel surface used by legacy components.'],
  ['.glass-strong', 'Stronger translucent surface variant.'],
  ['[data-theme]', 'Set on <html>; exposes the active theme id.'],
];

const manifestExample = `{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What the plugin adds to AuroraMP.",
  "wip": false,
  "defaultEnabled": false,
  "capabilities": ["player-panel"]
}`;

const registrationExample = `// src/lib/plugins.ts
{
  id: 'myPlugin',              // becomes a key in PluginPreferences
  name: 'My Plugin',
  version: '1.0.0',
  author: 'Your name',
  description: 'Adds a custom player panel.',
  wip: false,
  defaultEnabled: false,
  capabilities: ['player-panel'],
}

// Then gate the feature in a client component:
const enabled = useSettingsStore((state) => state.plugins.myPlugin);
if (!enabled) return null;`;

const communityPluginExample = `// Save this as now-playing-enhancer.js and upload it in Marketplace > Plugins.
function init(hostAPI) {
  const track = hostAPI.player.getCurrentTrack();
  const title = track ? track.title : 'nothing playing';

  hostAPI.storage.setItem('lastTrack', title);
  hostAPI.ui.showToast('Now Playing Enhancer loaded');

  // Optional cleanup runs when the plugin is disabled or deleted.
  return function cleanup() {
    hostAPI.ui.showToast('Now Playing Enhancer stopped');
  };
}

// CommonJS is also supported:
// module.exports = { init };`;

const hostApiRows = [
  ['player.play()', 'Resume the current track.'],
  ['player.pause()', 'Pause the current track.'],
  ['player.next()', 'Skip to the next playable track.'],
  ['player.getCurrentTrack()', 'Return a detached copy of the current track, or null.'],
  ['ui.showToast(message)', 'Show a short AuroraMP notification.'],
  ['storage.getItem(key)', 'Read a string scoped to this plugin.'],
  ['storage.setItem(key, value)', 'Write a string scoped to this plugin.'],
];

const cssExample = `/* Accent override + custom player border */
:root {
  --term-accent: #f59e0b;
  --term-border-bright: var(--term-accent);
}

.player-shell {
  border-top-width: 2px;
  border-top-color: var(--term-accent);
}

[data-theme="paper"] .app-main {
  background-image: linear-gradient(
    135deg,
    rgba(15, 118, 110, 0.04),
    transparent 45%
  );
}`;

export default function DevelopersPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5 font-mono text-xs">
      <header className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--term-text-dim)]">
              AuroraMP / Developer Docs
            </div>
            <h1 className="mt-1 text-lg font-bold text-[var(--term-text-bright)]">
              Extend AuroraMP
            </h1>
            <p className="mt-1 max-w-2xl leading-relaxed text-[var(--term-text-muted)]">
              Write custom CSS against the terminal design tokens, register a
              compile-time plugin manifest, or upload a community JavaScript
              plugin that runs against the restricted host API.
            </p>
          </div>
          <Link
            href="/marketplace"
            className="border border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] px-3 py-1.5 font-semibold text-[var(--term-invert-text)]"
          >
            [ OPEN MARKETPLACE ]
          </Link>
        </div>

        <nav className="mt-3 flex flex-wrap gap-2 border-t border-[var(--term-border)] pt-3 text-[10px]">
          <a href="#css" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ CSS ]
          </a>
          <a href="#classes" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ CLASSES ]
          </a>
          <a href="#plugins" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ PLUGINS ]
          </a>
          <a href="#community" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ COMMUNITY PLUGINS ]
          </a>
          <a href="#host-api" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ HOST API ]
          </a>
          <a href="#manifest" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ MANIFEST ]
          </a>
          <a href="#api" className="border border-[var(--term-border)] px-2 py-1 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]">
            [ API ]
          </a>
        </nav>
      </header>

      <section id="css" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Custom CSS
        </h2>

        <div className="space-y-2 leading-relaxed text-[var(--term-text-muted)]">
          <p>
            Open <strong className="text-[var(--term-text-bright)]">Marketplace → Themes → Custom CSS Editor</strong>{' '}
            and write standard CSS. The string is stored in localStorage and in
            your profile, then inserted into the document head as:
          </p>
          <pre className="overflow-x-auto border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] text-[var(--term-border-bright)]">
{`<style id="aurora-custom-css">/* your CSS */</style>`}
          </pre>
          <p>
            The editor accepts up to 50,000 characters. Custom CSS is applied
            after the built-in theme variables, so later declarations win. Do
            not depend on unstable class names outside the documented surface.
          </p>
        </div>

        <div className="overflow-x-auto border border-[var(--term-border)]">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[var(--term-bg-input)] text-[10px] uppercase text-[var(--term-text-dim)]">
              <tr>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Variable</th>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {cssVariables.map(([name, purpose]) => (
                <tr key={name} className="border-b border-[var(--term-border)] last:border-b-0">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[var(--term-border-bright)]">{name}</td>
                  <td className="px-2.5 py-1.5 text-[var(--term-text-muted)]">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-[var(--term-text-bright)]">Example</h3>
          <pre className="overflow-x-auto border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] leading-relaxed text-[var(--term-text-bright)]">
            {cssExample}
          </pre>
        </div>
      </section>

      <section id="classes" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Classes &amp; Theme Hooks
        </h2>
        <p className="leading-relaxed text-[var(--term-text-muted)]">
          The layout is intentionally terminal-like. Prefer the CSS variables
          above and the stable hooks below. Components use Tailwind utilities
          internally, so generic utility names are not a public API.
        </p>
        <div className="overflow-x-auto border border-[var(--term-border)]">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[var(--term-bg-input)] text-[10px] uppercase text-[var(--term-text-dim)]">
              <tr>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Hook</th>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Scope</th>
              </tr>
            </thead>
            <tbody>
              {classNames.map(([name, purpose]) => (
                <tr key={name} className="border-b border-[var(--term-border)] last:border-b-0">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[var(--term-border-bright)]">{name}</td>
                  <td className="px-2.5 py-1.5 text-[var(--term-text-muted)]">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-relaxed text-[var(--term-text-dim)]">
          Theme ids currently include <code className="text-[var(--term-border-bright)]">green</code>,{' '}
          <code className="text-[var(--term-border-bright)]">cool</code>,{' '}
          <code className="text-[var(--term-border-bright)]">amber</code>,{' '}
          <code className="text-[var(--term-border-bright)]">crimson</code>,{' '}
          <code className="text-[var(--term-border-bright)]">violet</code> and{' '}
          <code className="text-[var(--term-border-bright)]">paper</code>. Target them with{' '}
          <code className="text-[var(--term-border-bright)]">[data-theme=&quot;amber&quot;]</code>.
        </p>
      </section>

      <section id="plugins" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Plugin System
        </h2>
        <div className="space-y-2 leading-relaxed text-[var(--term-text-muted)]">
          <p>
            Built-in plugins are registered at build time in{' '}
            <code className="text-[var(--term-border-bright)]">src/lib/plugins.ts</code>.
            Each plugin contributes a manifest and a boolean flag under{' '}
            <code className="text-[var(--term-border-bright)]">preferences.plugins</code>.
            Community plugins are uploaded at runtime instead; their per-user
            flags live under{' '}
            <code className="text-[var(--term-border-bright)]">preferences.communityPlugins</code>{' '}
            and are documented in the next section.
          </p>
          <p>
            A plugin can be WIP while still being usable. JAM is the reference
            implementation: it carries a red WIP badge, and its feature flag
            controls the player/track buttons and room access.
          </p>
        </div>

        <h3 className="text-[11px] font-semibold text-[var(--term-text-bright)]">Create a plugin</h3>
        <ol className="list-decimal space-y-1 pl-5 leading-relaxed text-[var(--term-text-muted)]">
          <li>Add an id to the <code className="text-[var(--term-border-bright)]">PluginId</code> union and a manifest to <code className="text-[var(--term-border-bright)]">PLUGIN_CATALOG</code>.</li>
          <li>Set <code className="text-[var(--term-border-bright)]">defaultEnabled</code> and optional <code className="text-[var(--term-border-bright)]">wip</code>.</li>
          <li>Read the flag with <code className="text-[var(--term-border-bright)]">useSettingsStore((state) =&gt; state.plugins.myPlugin)</code>.</li>
          <li>Render the UI only when the flag is on, or show a gated state for deep links.</li>
          <li>Add the capability tags and a description so the Marketplace card is self-explanatory.</li>
          <li>Persist any plugin-owned data separately; only the flag belongs in preferences.</li>
        </ol>

        <pre className="overflow-x-auto border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] leading-relaxed text-[var(--term-text-bright)]">
          {registrationExample}
        </pre>
      </section>

      <section id="community" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Community JavaScript Plugins
        </h2>
        <div className="space-y-2 leading-relaxed text-[var(--term-text-muted)]">
          <p>
            Want to share or request a community <code className="text-[var(--term-border-bright)]">.js</code> plugin?
            Click <strong className="text-[var(--term-text-bright)]">Marketplace → Plugins → [ SUBMIT ON DISCORD ]</strong> or join{' '}
            <a
              href="https://discord.gg/GTDb58kMGK"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--term-border-bright)] underline"
            >
              discord.gg/GTDb58kMGK
            </a>{' '}
            to submit your plugin for review and distribution. Local plugin files live in the AuroraMP XDG data directory under{' '}
            <code className="text-[var(--term-border-bright)]">plugins/</code>{' '}
            and metadata is stored in the local SQLite{' '}
            <code className="text-[var(--term-border-bright)]">plugins</code>{' '}
            table.
          </p>
          <p>
            Use a plain script or CommonJS. ES module syntax (
            <code className="text-[var(--term-border-bright)]">import</code> /{' '}
            <code className="text-[var(--term-border-bright)]">export</code>) and
            top-level await are not supported. The file must define{' '}
            <code className="text-[var(--term-border-bright)]">init(hostAPI)</code>{' '}
            directly, assign it to a variable, or expose it as{' '}
            <code className="text-[var(--term-border-bright)]">module.exports.init</code>.
          </p>
        </div>

        <pre className="overflow-x-auto border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] leading-relaxed text-[var(--term-text-bright)]">
          {communityPluginExample}
        </pre>

        <ul className="list-disc space-y-1 pl-5 leading-relaxed text-[var(--term-text-muted)]">
          <li><code className="text-[var(--term-border-bright)]">init(hostAPI)</code> runs once when the plugin is enabled and enforces the restricted host API surface below.</li>
          <li>The host catches initialization errors and shows a toast instead of crashing the app. Async <code className="text-[var(--term-border-bright)]">init</code> functions are awaited.</li>
          <li>Return a cleanup function, or an object with <code className="text-[var(--term-border-bright)]">dispose()</code> or <code className="text-[var(--term-border-bright)]">destroy()</code>, to release timers or listeners when the plugin is disabled.</li>
          <li>Enabled state is saved locally as <code className="text-[var(--term-border-bright)]">preferences.communityPlugins[pluginId]</code> in localStorage.</li>
        </ul>
      </section>

      <section id="host-api" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Host API &amp; Security
        </h2>

        <div className="border border-red-900 bg-red-950/20 p-3 text-[11px] leading-relaxed text-red-200">
          <strong>Community plugins run in an isolated iframe.</strong> The
          uploaded source is delivered over IPC and executed in a sandboxed
          {' '}<code>iframe</code> without <code>allow-same-origin</code>, so it gets a
          unique opaque origin and cannot access the AuroraMP document, storage,
          network APIs or Tauri IPC. The frame CSP blocks network requests, and
          only the postMessage host API below is exposed. A plugin is still
          arbitrary JavaScript inside its own origin, so only enable plugins from
          trusted sources.
        </div>

        <div className="overflow-x-auto border border-[var(--term-border)]">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[var(--term-bg-input)] text-[10px] uppercase text-[var(--term-text-dim)]">
              <tr>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Method</th>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Behaviour</th>
              </tr>
            </thead>
            <tbody>
              {hostApiRows.map(([method, behaviour]) => (
                <tr key={method} className="border-b border-[var(--term-border)] last:border-b-0">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[var(--term-border-bright)]">{method}</td>
                  <td className="px-2.5 py-1.5 text-[var(--term-text-muted)]">{behaviour}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] leading-relaxed text-[var(--term-text-muted)]">
          Storage keys are automatically namespaced as{' '}
          <code className="text-[var(--term-border-bright)]">aurora-plugin:&lt;plugin-id&gt;:&lt;key&gt;</code>.
          Plugins cannot read another plugin&apos;s storage through the host API.
          The host returns a copy of the current track so plugins cannot mutate
          player state directly.
        </p>

        <p className="text-[11px] leading-relaxed text-[var(--term-text-dim)]">
          Plugin files are loaded locally over Tauri IPC directly from the AuroraMP XDG data directory (<code className="text-[var(--term-border-bright)]">plugins/</code>) with path-traversal protection.
        </p>
      </section>

      <section id="manifest" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Built-in Manifest Schema
        </h2>
        <pre className="overflow-x-auto border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] leading-relaxed text-[var(--term-text-bright)]">
          {manifestExample}
        </pre>
        <div className="overflow-x-auto border border-[var(--term-border)]">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[var(--term-bg-input)] text-[10px] uppercase text-[var(--term-text-dim)]">
              <tr>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Field</th>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Type</th>
                <th className="border-b border-[var(--term-border)] px-2.5 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['id', 'PluginId', 'Stable key used by preferences and the settings store.'],
                ['name', 'string', 'Human-readable name shown in the Marketplace.'],
                ['version', 'string', 'Semver-style version for display.'],
                ['author', 'string', 'Maintainer name.'],
                ['description', 'string', 'One or two sentences describing the feature.'],
                ['wip', 'boolean', 'Shows red WIP labels and banners; does not disable the feature.'],
                ['defaultEnabled', 'boolean', 'Initial flag for new and legacy profiles.'],
                ['capabilities', 'string[]', 'Discovery tags such as player-panel or discord-presence.'],
              ].map(([field, type, notes]) => (
                <tr key={field} className="border-b border-[var(--term-border)] last:border-b-0">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[var(--term-border-bright)]">{field}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[var(--term-text-muted)]">{type}</td>
                  <td className="px-2.5 py-1.5 text-[var(--term-text-muted)]">{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="api" className="scroll-mt-4 space-y-3 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <h2 className="border-b border-[var(--term-border)] pb-2 text-sm font-semibold text-[var(--term-text-bright)]">
          Local Preferences Schema
        </h2>
        <p className="leading-relaxed text-[var(--term-text-muted)]">
          AuroraMP Desktop runs 100% locally without requiring an account. Theme, plugin flags, custom CSS, and player customization are persisted in local storage and synchronized with the local Tauri SQLite database.
        </p>

        <pre className="overflow-x-auto border border-[var(--term-border)] bg-[var(--term-bg-input)] p-3 text-[11px] leading-relaxed text-[var(--term-text-bright)]">
{`{
  "theme": "green",
  "plugins": {
    "lyricsOverlay": true,
    "equalizer": false
  },
  "communityPlugins": {
    "plg-0123456789abcdef0123456789abcdef": true
  },
  "customCss": ":root { --term-border-bright: #38bdf8; }",
  "playerCustomization": {
    "background": "#0a0e0a",
    "accentColor": "#22c55e",
    "fontSize": 16
  }
}`}
        </pre>
      </section>
    </div>
  );
}
