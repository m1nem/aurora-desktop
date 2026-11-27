import { Play, Pause } from 'lucide-react';
// AURORA_PATCH: PlaylistsView v4 - CSV import + clean CLI aesthetics
'use client';

import { apiExportPlaylistCsv, apiFetch } from '@/lib/api';
import { useRef, useState } from 'react';
// AURORA_FIX_PLAYLISTS_V1
import { usePlayerStore } from '@/store/usePlayerStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { getCachedAudioUrl } from '@/lib/audioCache';
import { isUsableDuration } from '@/lib/audioDuration';
import { isTauriAssetUrl, trackMediaUrl } from '@/lib/media';
import { formatTime, cn } from '@/lib/utils';
import type { Playlist, Track } from '@/types';

interface ImportResponse {
  playlist?: Playlist;
  playlists?: Playlist[];
  tracks?: Track[];
  stats?: {
    totalRows?: number;
    imported?: number;
    duplicates?: number;
    skipped?: number;
  };
  error?: string;
}

export function PlaylistsView() {
  const playlists = usePlayerStore((s) => s.playlists);
  const tracks = usePlayerStore((s) => s.tracks);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const removeTrackFromPlaylist = usePlayerStore((s) =>
    s.removeTrackFromPlaylist
  );
  const updateTrack = usePlayerStore((s) => s.updateTrack);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const mergeLibrary = usePlayerStore((s) => s.mergeLibrary);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const user = useAuthStore((s) => s.user);
  const ytdlpEnabled = useSettingsStore((s) => s.plugins.ytdlp);

  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const active = playlists.find((p) => p.id === selected) || null;
  const activeTracks: Track[] = active
    ? active.trackIds
        .map((id) => tracks.find((t) => t.id === id))
        .filter((t): t is Track => !!t)
    : [];
  const playableTracks = activeTracks.filter((t) => t.source !== 'imported');

  const handleCreate = () => {
    const n = newName.trim();
    if (!n) return;
    const id = createPlaylist(n);
    setNewName('');
    setSelected(id);
  };

  const exportCsv = async () => {
    if (!user || exportBusy) return;
    setExportBusy(true);
    setExportStatus(null);
    try {
      const result = await apiExportPlaylistCsv();
      setExportStatus(`CSV written to ${result.filePath}`);
    } catch (error) {
      setExportStatus(
        error instanceof Error ? error.message : 'CSV export failed.'
      );
    } finally {
      setExportBusy(false);
    }
  };

  const importCsv = (file: File | null) => {
    if (!file) return;
    if (importBusy) return;
    if (!user) {
      setImportError('Sign in to import a playlist into your account.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setImportError('Choose a CSV file exported from Exportify.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setImportError('The CSV file must be smaller than 8 MB.');
      return;
    }

    setImportBusy(true);
    setImportProgress(5);
    setImportError(null);
    setImportStatus('Uploading CSV...');

    const form = new FormData();
    form.append('file', file);
    form.append(
      'name',
      file.name
        .replace(/\.csv$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

    void (async () => {
      try {
        setImportProgress(30);
        setImportStatus('Parsing CSV and creating playlist...');

        const response = await apiFetch('/api/playlists/import', {
          method: 'POST',
          body: form,
        });
        const data = (await response.json().catch(() => ({}))) as ImportResponse;

        setImportProgress(100);

        if (!response.ok) {
          setImportStatus(null);
          setImportError(
            data.error || `Import failed (HTTP ${response.status}).`
          );
          return;
        }

        if (!data.playlist) {
          setImportStatus(null);
          setImportError('The backend did not return an imported playlist.');
          return;
        }

        mergeLibrary(data.tracks ?? [], data.playlists ?? [], user.id);
        setSelected(data.playlist.id);

        const imported = Number(data.stats?.imported ?? 0);
        const duplicates = Number(data.stats?.duplicates ?? 0);
        const skipped = Number(data.stats?.skipped ?? 0);
        const extras = [
          duplicates > 0 ? `${duplicates} duplicate(s) skipped` : '',
          skipped > 0 ? `${skipped} row(s) skipped` : '',
        ]
          .filter(Boolean)
          .join(', ');

        setImportStatus(
          `Imported ${imported} track(s) into "${data.playlist.name}"${
            extras ? ` — ${extras}` : ''
          }.`
        );
      } catch (error) {
        setImportStatus(null);
        setImportError(
          error instanceof Error
            ? error.message
            : 'Could not import the CSV file.'
        );
      } finally {
        setImportBusy(false);
      }
    })();
  };

  /**
   * Makes the playlist playable offline on this device. YouTube tracks are
   * downloaded into the local media root with yt-dlp when missing, and remote
   * audio is written to CacheStorage. Local asset files are only verified.
   */
  const syncPlaylistToDevice = async () => {
    if (!active || activeTracks.length === 0 || offlineBusy) return;

    setOfflineBusy(true);
    let done = 0;
    let failed = 0;
    let unsupported = 0;

    for (let i = 0; i < activeTracks.length; i++) {
      const track = activeTracks[i];

      if (track.source === 'imported') {
        unsupported += 1;
        continue;
      }

      setOfflineStatus(
        `[ ${i + 1}/${activeTracks.length} ] ${track.title}`
      );

      try {
        let playableUrl = trackMediaUrl(track);

        if (track.source === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(track.id)) {
          if (!ytdlpEnabled && !track.filePath) {
            unsupported += 1;
            continue;
          }
          const params = new URLSearchParams({
            id: track.id,
            title: track.title,
            author: track.author,
            duration: String(track.duration || 0),
            thumbnail: track.thumbnail || '',
            external: '1',
          });
          const res = await apiFetch(`/api/download?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            if (data.url) {
              playableUrl = trackMediaUrl(
                (data.track as Track | undefined) ?? {
                  ...track,
                  url: data.url as string,
                }
              );
              if (data.track?.filePath || data.url !== track.url) {
                updateTrack(track.id, {
                  url: data.url as string,
                  filePath: data.track?.filePath,
                });
              }
            }
          }
        }

        if (isTauriAssetUrl(playableUrl)) {
          // The file already lives in the app data directory. Verify that the
          // asset protocol can read it; creating a Blob here would only leak
          // an object URL that nothing plays.
          const response = await fetch(playableUrl);
          if (!response.ok) {
            throw new Error(`asset protocol returned HTTP ${response.status}`);
          }
        } else {
          const cachedUrl = await getCachedAudioUrl(playableUrl);
          if (cachedUrl.startsWith('blob:')) {
            URL.revokeObjectURL(cachedUrl);
          }
        }
        done++;
      } catch (err) {
        console.warn('[playlist sync] Could not cache', track.title, err);
        failed++;
      }
    }

    setOfflineStatus(
      `Cached ${done}/${activeTracks.length} track(s)${
        failed > 0 ? ` — ${failed} failed` : ''
      }${
        unsupported > 0
          ? ` — ${unsupported} imported track(s) have no audio source yet`
          : ''
      }.`
    );
    setOfflineBusy(false);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-[var(--term-text-bright)]">
              Playlists
            </h1>
            <p className="text-[var(--term-text-muted)] text-xs mt-1 leading-relaxed">
              Group indexed local and streaming audio tracks into custom sequential
              playlists, or import a Spotify playlist exported with Exportify.
            </p>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={!user || importBusy}
              title={
                user
                  ? 'Import an Exportify CSV into a new playlist'
                  : 'Sign in to import a playlist'
              }
              className="h-9 px-4 border border-[var(--term-border-bright)] text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] font-semibold disabled:opacity-40 transition-none"
            >
              {importBusy ? '[ Importing... ]' : '[ Import Playlist (CSV) ]'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                importCsv(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            {!user && (
              <span className="text-[10px] text-[var(--term-text-dim)]">
                Sign in to import a playlist.
              </span>
            )}
          </div>
        </div>

        {importBusy && (
          <div className="mt-3 space-y-1" role="status" aria-live="polite">
            <div className="h-1.5 w-full border border-[var(--term-border)] bg-[var(--term-bg-input)] overflow-hidden">
              <div
                className="h-full bg-[var(--term-border-bright)] transition-[width] duration-150"
                style={{ width: `${importProgress}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--term-text-muted)]">
              {importStatus}
            </p>
          </div>
        )}

        {!importBusy && importStatus && (
          <p
            className="mt-3 border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2.5 py-2 text-[11px] text-[var(--term-text-muted)]"
            role="status"
            aria-live="polite"
          >
            {importStatus}
          </p>
        )}

        {importError && (
          <p className="mt-3 border border-red-900 bg-red-950/40 px-2.5 py-2 text-[11px] text-red-300">
            {importError}
          </p>
        )}
      </div>

      {!active ? (
        <div className="space-y-4">
          {/* Create new playlist box */}
          <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-3 flex flex-wrap items-center gap-2">
            <span className="text-[var(--term-border-bright)] font-bold">&gt;</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="New playlist name..."
              className="flex-1 min-w-[200px] h-9 px-3 bg-[var(--term-bg-input)] border border-[var(--term-border)] text-xs text-[var(--term-text-bright)] placeholder:text-[var(--term-text-muted)] focus:outline-none focus:border-[var(--term-border-bright)] rounded-none"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="h-9 px-4 border border-[var(--term-border-bright)] text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] font-semibold disabled:opacity-40 transition-none"
            >
              [ + Create Playlist ]
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!user || exportBusy || playlists.length === 0}
              title={
                user
                  ? 'Write all playlists to a CSV file in the Aurora data directory'
                  : 'Sign in to export playlists'
              }
              className="h-9 px-4 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] font-semibold disabled:opacity-40 transition-none"
            >
              {exportBusy ? '[ Exporting... ]' : '[ Export CSV ]'}
            </button>
          </div>

          {exportStatus && (
            <p className="border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--term-text-muted)] break-all">
              {exportStatus}
            </p>
          )}

          {playlists.length === 0 ? (
            <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-6 text-center">
              <p className="text-[var(--term-text-bright)] font-semibold mb-1">
                No playlists yet.
              </p>
              <p className="text-[var(--term-text-muted)]">
                Create a playlist above to organize your music collections.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {playlists.map((p, idx) => (
                <div
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-3.5 cursor-pointer hover:border-[var(--term-border-bright)] hover:bg-[var(--term-bg-hover)] transition-none select-none flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--term-text-dim)] border-b border-[var(--term-border)] pb-1.5 mb-2">
                      <span>Playlist {String(idx + 1).padStart(2, '0')}</span>
                      <span>{p.trackIds.length} {p.trackIds.length === 1 ? 'track' : 'tracks'}</span>
                    </div>
                    <div className="text-sm font-semibold text-[var(--term-text-bright)] truncate">
                      {p.name}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-2 border-t border-[var(--term-border)]">
                    <span className="text-[11px] text-[var(--term-border-bright)]">
                      Open &gt;&gt;
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete playlist "${p.name}"?`)) {
                          deletePlaylist(p.id);
                        }
                      }}
                      className="text-[11px] text-red-400 hover:text-red-300 border border-transparent hover:border-red-800 px-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelected(null)}
              className="px-2.5 py-1 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
            >
              &lt;&lt; Back to playlists
            </button>
          </div>

          <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[10px] text-[var(--term-text-dim)] uppercase">
                Active Playlist
              </span>
              <h2 className="text-base font-bold text-[var(--term-text-bright)] mt-0.5">
                {active.name}
              </h2>
              <p className="text-[11px] text-[var(--term-text-muted)]">
                {activeTracks.length} {activeTracks.length === 1 ? 'track' : 'tracks'}
              </p>
            </div>
            {activeTracks.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {playableTracks.length > 0 && (
                  <button
                    onClick={() => setCurrentTrack(playableTracks[0])}
                    className="px-3.5 py-1.5 border border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] font-semibold text-xs"
                  >
                    [ Play All ]
                  </button>
                )}
                <button
                  onClick={syncPlaylistToDevice}
                  disabled={offlineBusy}
                  title="Re-fetch missing audio and cache this playlist for offline playback on this device"
                  className="px-3.5 py-1.5 border border-[var(--term-border)] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] font-semibold text-xs disabled:opacity-40"
                >
                  {offlineBusy ? '[ Syncing... ]' : '[ Sync to Device ]'}
                </button>
              </div>
            )}
          </div>

          {offlineStatus && (
            <div className="border border-[var(--term-border)] bg-[var(--term-bg-input)] px-3 py-2 text-[11px] text-[var(--term-text-muted)]">
              {offlineStatus}
            </div>
          )}

          {activeTracks.length > 0 && playableTracks.length === 0 && (
            <div className="border border-amber-900 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
              This playlist only contains imported Spotify metadata. The tracks
              are saved, but they need an audio source before they can play.
            </div>
          )}

          {activeTracks.length === 0 ? (
            <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-6 text-center">
              <p className="text-[var(--term-text-bright)] font-semibold mb-1">
                Playlist is empty.
              </p>
              <p className="text-[var(--term-text-muted)]">
                Add tracks using the [+PL] button in the library.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {activeTracks.map((t, i) => {
                const isCurrent = currentTrack?.id === t.id;
                const isImported = t.source === 'imported';
                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      if (isImported) {
                        setOfflineStatus(
                          `"${t.title}" is imported metadata and has no audio source yet. Search YouTube to add a playable version.`
                        );
                        return;
                      }
                      setCurrentTrack(t);
                    }}
                    className={cn(
                      'border p-2.5 flex items-center gap-3 select-none transition-none',
                      isImported ? 'cursor-default' : 'cursor-pointer',
                      isCurrent
                        ? 'border-[var(--term-border-bright)] bg-[var(--term-bg-hover)]'
                        : 'border-[var(--term-border)] bg-[var(--term-bg-panel)] hover:bg-[var(--term-bg-hover)]'
                    )}
                  >
                    <span className="text-xs font-semibold w-8 shrink-0 text-[var(--term-text-dim)]">
                      {isCurrent ? (isPlaying ? <Play className="w-3 h-3 inline text-[var(--term-border-bright)] fill-current" /> : <Pause className="w-3 h-3 inline text-[var(--term-border-bright)] fill-current" />) : String(i + 1).padStart(2, '0')}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[var(--term-text-bright)] truncate">
                        {t.title}
                      </p>
                      <p className="text-[11px] text-[var(--term-text-muted)] truncate">
                        {t.author}
                        {t.album ? ` — ${t.album}` : ''}
                      </p>
                    </div>

                    {isImported && (
                      <span className="shrink-0 border border-[var(--term-border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--term-text-dim)]">
                        Imported
                      </span>
                    )}

                    <div className="text-[11px] text-[var(--term-text-muted)] tabular-nums shrink-0">
                      {isUsableDuration(t.duration) ? formatTime(t.duration) : '--:--'}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTrackFromPlaylist(active.id, t.id);
                      }}
                      className="px-2 py-0.5 border border-red-900 text-red-400 hover:bg-red-600 hover:text-black text-xs"
                      title="Remove from playlist"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
