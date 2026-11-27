<div align="center">

# 🎧 AuroraMP Desktop

**Local-first, high-contrast terminal & monospace audio player built with Tauri, Rust, and React.**

[![Tauri](https://img.shields.io/badge/Tauri-Desktop-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-rodio%20Engine-DEA584?style=for-the-badge&logo=rust&logoColor=black)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-Terminal_UI-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Zustand](https://img.shields.io/badge/State-Zustand-764ABC?style=for-the-badge)](https://zustand-demo.pmnd.rs/)

[Features](#-key-features) • [Tech Stack](#-tech-stack) • [Project Structure](#-project-structure) • [Quick Start](#-quick-start) • [Customization & Plugins](#-customization--plugins)

</div>

---

## ✨ Key Features

* **🖥️ Native Rust Audio Engine (`rodio` + `NativeAudioController`)**:
  * Plays local audio files (including `MP3`, `WAV`, `OGG`, `OGA`, `M4A`, `AAC`, `FLAC`, `OPUS`, and `WEBM`) with seeking, volume control, mute, looping, and a Web Audio fallback for streaming or blob sources.
  * Automatically detects and recovers track durations via the Web Audio API (`decodeAudioData`) when header metadata is incomplete or VBR.
  * Integrates with system media controls (`navigator.mediaSession`) and handles files passed from the OS file manager on startup (`take_startup_audio`).
* **📝 Synchronized Lyrics (Word & Letter Sync)**:
  * Fetches matching lyrics from **LRCLIB** (scoring candidates by closest duration match) with a fallback to **Lyrics.ovh**.
  * Smooth 60 FPS clock powered by `requestAnimationFrame`, word-by-word and letter-by-letter animations, `[offset:]` tag support, and click-to-seek on lines or words.
  * Full-screen **Now Playing** view (`ESC`, `F11`, or `F` to exit; `Space` to play/pause) alongside a slide-out **Lyrics Viewer** panel.
* **📚 Library, Playlists & CSV**:
  * Local library management with title/artist filtering, directory scanning, and orphaned audio recovery (`Recover MP3s`).
  * Playlist creation and editing, `Shuffle` and `Repeat` (`off` / `all` / `one`) modes, plus **CSV playlist import and export** (including Exportify exports) and device playlist sync.
* **🔍 Search & Optional Download (`yt-dlp`)**:
  * Music search as well as an external mode powered by the **YouTube Downloader (`yt-dlp`)** plugin (requires `yt-dlp` and `ffmpeg`, inactive until explicitly triggered).
* **🎮 Discord Rich Presence over Native IPC**:
  * Connects directly to the local Discord client socket (`discord-ipc-*`, activity type *Listening (2)*) with no external HTTP daemon required.
  * Supports Aurora's default application ID or a custom 17–20 digit Application ID, complete with a connection test in Settings.
* **🎨 Terminal Themes, Custom CSS & Sandboxed Plugins**:
  * Built-in presets (*Green Phosphor*, *Cool Monospace*, *Amber CRT*, *Crimson Night*, *Ultraviolet*, *Paper Mono*), custom background/accent colors, base font size scaling (`12px–20px`), and live **Custom CSS** injection (up to `50,000` characters).
  * Isolated community plugin runtime inside `<iframe sandbox="allow-scripts">` with network-blocking CSP and a scoped `hostAPI` (`player`, `ui`, `storage`).
* **🐧 Linux Desktop Integration**:
  * Registers audio MIME type handlers and sets or restores the default music player via `xdg-mime` and `.desktop` entries.

---

## 🛠️ Tech Stack

| Layer | Technologies / Tools |
| :--- | :--- |
| **Desktop Shell** | **Tauri** (`@tauri-apps/api/core`, `@tauri-apps/api/window`, `convertFileSrc`) |
| **Backend / Audio Engine** | **Rust**, **rodio** (`Decoder`, `OutputStream`, `Sink`, `Source`), `serde`, multi-threaded command channel (`mpsc`) |
| **Frontend** | **React**, **TypeScript**, **React Router** (`HashRouter` + Next-style compatibility shims), **Lucide Icons**, **Framer Motion** |
| **Styling** | **Tailwind CSS v4**, `--term-*` CSS variables, **JetBrains Mono** (`@fontsource/jetbrains-mono`) |
| **State Management** | **Zustand** (`persist` + dedicated stores: `usePlayerStore`, `useSettingsStore`, `usePluginStore`, `useAuthStore`, `useJamStore`, `useLyricsStore`, `useToastStore`) |
| **Data & Integrations** | **LRCLIB API**, **Lyrics.ovh API**, **Discord IPC**, **yt-dlp** + **ffmpeg**, `xdg-mime` |

---

## 🗂️ Project Structure

```text
src/
├── App.tsx                     # Root router (HashRouter) and application views
├── main.tsx                    # Entry point, JetBrains Mono fonts, external link interception
├── components/
│   ├── AppShell.tsx            # Main shell: TitleBar, Sidebar, mobile nav, Player, runtime
│   ├── TitleBar.tsx            # Custom Tauri window bar, route indicator, Ko-fi link, window controls
│   ├── Sidebar.tsx             # Sidebar navigation (Home, Search, Library, Playlists, Marketplace, Settings)
│   ├── Player.tsx              # Bottom player bar, MediaSession, Discord RPC, playback mode controls
│   ├── NowPlayingScreen.tsx    # Full-screen view with artwork, controls, and lyrics
│   ├── LyricsPanel.tsx         # Side drawer for track lyrics
│   ├── LyricsView.tsx          # LRC/plain parser, word & letter sync (60 FPS)
│   ├── PlaylistsView.tsx       # Playlist management, CSV import/export, device sync
│   ├── TrackList.tsx           # Track/result list, filtering, download, and actions
│   ├── SearchBar.tsx           # Search input (Music search & External yt-dlp) + file import
│   ├── ImportButton.tsx        # Import individual audio files and entire folders
│   ├── RecoverButton.tsx       # Scan and recover local audio files into the library
│   ├── AddToPlaylistMenu.tsx   # Quick-add tracks to existing or new playlists
│   ├── PluginRuntime.tsx       # Sandboxed iframe host for community plugins
│   ├── UploadPluginModal.tsx   # Modal for uploading .js plugins (up to 500 KB)
│   ├── ThemeInjector.tsx       # Dynamic --term-* variable computation and Custom CSS injection
│   ├── StartupFiles.tsx        # Handles audio files passed on application launch
│   ├── ToastHost.tsx           # Application toast notification queue
│   ├── WipBadge.tsx            # Badges for experimental / in-progress features
│   └── ui/                     # Button, Card, Slider, VolumeSlider
├── lib/
│   ├── api.ts                  # Typed Tauri `invoke` bridge + `/api/*` compatibility router
│   ├── nativeAudio.ts          # Controller bridging the audio UI with the Rust backend (`audio_*`)
│   ├── media.ts                # Tauri asset URL conversion and share links
│   ├── audioDuration.ts        # Duration decoding via Web Audio API
│   ├── audioCache.ts           # Audio cache helper layer
│   ├── lyrics.ts / lyricsClient.ts # Fetching, candidate scoring, and LRC format parsing
│   ├── discordClient.ts / discordConfig.ts # Setting and clearing Discord Rich Presence activity
│   ├── librarySync.ts          # Library and session state synchronization
│   ├── plugins.ts / pluginSandbox.ts # Built-in plugin catalog and iframe sandbox
│   ├── preferences.ts / themes.ts # Preference normalization, themes, and WCAG contrast helpers
│   ├── externalLink.ts         # Opening external links via Tauri / browser
│   ├── next-link.tsx / next-navigation.ts # Navigation adapters
│   └── utils.ts                # CSS class helpers (`cn`) and time formatting (`formatTime`)
├── pages/
│   ├── HomePage.tsx            # Home dashboard and recently added tracks
│   ├── SearchPage.tsx          # Search view (Music Search / External yt-dlp)
│   ├── LibraryPage.tsx         # Full music library view
│   ├── PlaylistsPage.tsx       # Playlists view
│   ├── MarketplacePage.tsx     # Plugins, themes, palette, and Custom CSS management
│   ├── DevelopersPage.tsx      # Docs for CSS variables, manifests, plugins, and Host API
│   ├── SettingsPage.tsx        # Discord IPC, yt-dlp, Linux integration, and storage settings
│   └── TrackPage.tsx           # Single track details view
├── store/                      # Zustand stores (Player, Settings, Plugin, Auth, Jam, Lyrics, Toast)
├── styles/globals.css          # Base themes, --term-* variables, and scrollbar styles
└── src-tauri/
    ├── capabilities/default.json # Tauri window capabilities (least-privilege permissions)
    └── src/audio_engine.rs     # Rust audio engine built on `rodio`
```

---

## 🚀 Quick Start

### Prerequisites
* **Node.js** and a package manager (`npm` / `pnpm`)
* **Rust** (`rustc`, `cargo`) and system dependencies required by **Tauri**
* *(Optional)* **`yt-dlp`** and **`ffmpeg`** — if you want external search and audio downloading
* *(Optional)* **Discord Desktop Client** — if you want **Discord Rich Presence**

### Running in Development Mode

```bash
# 1. Install frontend dependencies
npm install

# 2. Launch the Tauri desktop app in dev mode
npm run tauri dev
```

> **Note:** Backend-powered features (the native `rodio` audio engine, library commands, Discord IPC, plugin loading, and OS integration) rely on Tauri commands (`invoke`). Running a plain browser preview without the Tauri runtime will indicate that the desktop backend is unavailable.

---

## 🎨 Customization & Plugins

### Themes & Custom CSS
Under **Marketplace → Themes**, you can:
* Switch between terminal presets (`green`, `cool`, `amber`, `crimson`, `violet`, `paper`),
* Customize background color, accent color, and base font size (`12px–20px`),
* Write **Custom CSS** (injected as `<style id="aurora-custom-css">`) using variables such as `--term-bg`, `--term-bg-panel`, `--term-border`, `--term-border-bright`, `--term-text`, `--term-accent`, and `--player-height`.

### Community Plugins (Host API)
`.js` plugins run inside an isolated `<iframe>` sandbox with a CSP that blocks network access and direct access to the parent DOM or Tauri IPC. A plugin exports an `init(hostAPI)` function (or `module.exports.init`) and can interact with a safe host API:

```javascript
function init(hostAPI) {
  const current = hostAPI.player.getCurrentTrack();
  if (current) {
    hostAPI.storage.setItem('lastPlayedTitle', current.title);
    hostAPI.ui.showToast(`Now playing: ${current.title}`);
  }

  return () => {
    // Optional cleanup callback called when the plugin is disabled
  };
}
```

Available `hostAPI` methods:
* `hostAPI.player.play()` / `pause()` / `next()` / `getCurrentTrack()`
* `hostAPI.ui.showToast(message)`
* `hostAPI.storage.getItem(key)` / `setItem(key, value)` (keys are automatically scoped per plugin)

You can also inspect CSS variables, classes, manifest schemas, and examples directly in-app under **Dev Docs** (`/developers`).

---

## ☕ Support the Project

If you use **AuroraMP** and want to support its development, check out the author's page: **[ko-fi.com/m1nem](https://ko-fi.com/m1nem)**.