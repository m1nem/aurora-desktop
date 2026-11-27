// AURORA_PATCH: Player v6 - Native Rust Audio Engine + Event-driven Discord RPC (Type: 2)
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { nativeAudio } from '@/lib/nativeAudio';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useJamStore } from '@/store/useJamStore';
import { useToastStore } from '@/store/useToastStore';
import { Slider } from './ui/Slider';
import { VolumeSlider } from './ui/VolumeSlider';
import { NowPlayingScreen } from './NowPlayingScreen';
import { LyricsPanel } from './LyricsPanel';
import { formatTime, cn } from '@/lib/utils';
import {
  sendDiscordActivity,
  clearDiscordActivity,
  clearDiscordActivityBeacon,
  type DiscordPresenceEvent,
} from '@/lib/discordClient';
import { shareLink, trackMediaUrl } from '@/lib/media';
import { getCachedAudioUrl } from '@/lib/audioCache';
import { isUsableDuration, readAudioDuration } from '@/lib/audioDuration';
import type { Track } from '@/types';

const MEDIA_SEEK_STEP_SECONDS = 10;

function absoluteMediaUrl(value: string): string {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${value}`;
  }
  return value;
}

function mediaArtwork(track: Track): MediaImage[] {
  const src = absoluteMediaUrl(track.thumbnail || '');
  if (!src) return [];

  return [
    {
      src,
      sizes: '512x512',
      type: /\.png(?:\?|$)/i.test(src) ? 'image/png' : 'image/jpeg',
    },
  ];
}

function mediaAlbum(track: Track): string {
  if (track.album) return track.album;
  if (track.source === 'youtube') return 'YouTube Music';
  if (track.source === 'local') return 'Local Library';
  if (track.source === 'imported') return 'Imported Playlist';
  return 'AuroraMP Cloud';
}

export function Player() {
  const router = useRouter();
  const audioRef = useRef<any>(nativeAudio);
  const footerRef = useRef<HTMLElement>(null);
  const durationProbeRef = useRef<Set<string>>(new Set());
  const durationRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const objectUrlRef = useRef<string | null>(null);
  const sourceGenerationRef = useRef(0);
  const isScrubbingRef = useRef(false);
  const prevTrackIdRef = useRef<string>('');
  const lastNonZeroVolumeRef = useRef<number>(0.8);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const showToast = useToastStore((state) => state.showToast);
  const lastAudioErrorRef = useRef('');

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playNonce = usePlayerStore((s) => s.playNonce);

  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const setDuration = usePlayerStore((s) => s.setDuration);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((s) => s.cycleRepeatMode);

  const currentTrackId = currentTrack?.id ?? '';
  const currentTrackUrl = trackMediaUrl(currentTrack);
  const currentTrackSource = currentTrack?.source ?? '';

  const discordEnabled = useSettingsStore((s) => s.discordEnabled);
  const discordAppId = useSettingsStore((s) => s.discordAppId);
  const lyricsPluginEnabled = useSettingsStore(
    (s) => s.plugins.lyricsOverlay
  );

  const jamSessionId = useJamStore((s) => s.sessionId);
  const isHost = useJamStore((s) => s.isHost);
  const isJoined = useJamStore((s) => s.isJoined);
  const listenersCount = useJamStore((s) => s.listenersCount);
  const createJam = useJamStore((s) => s.createJam);
  const leaveJam = useJamStore((s) => s.leaveJam);
  const setListenersCount = useJamStore((s) => s.setListenersCount);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;

    const root = document.documentElement;
    const updateHeight = () => {
      const height = Math.ceil(footer.getBoundingClientRect().height);
      if (height > 0) {
        root.style.setProperty('--player-height', `${height}px`);
      }
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateHeight);
      observer.observe(footer);
    }

    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
      root.style.removeProperty('--player-height');
    };
  }, []);

  const presenceStateRef = useRef<{
    trackId: string | null;
    isPlaying: boolean | null;
    sessionId: string | null;
    appId: string | null;
  }>({
    trackId: null,
    isPlaying: null,
    sessionId: null,
    appId: null,
  });
  const seekSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedDurationKeyRef = useRef('');
  const autoJamStartedRef = useRef(false);

  const pushPresence = useCallback(
    (
      event: DiscordPresenceEvent,
      overrides?: {
        position?: number;
        duration?: number;
        isPlaying?: boolean;
        track?: Track | null;
      }
    ) => {
      if (!discordEnabled) return;

      const state = usePlayerStore.getState();
      const track = overrides?.track ?? state.currentTrack;
      if (!track) return;

      const audio = audioRef.current;
      const audioPosition =
        audio && Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : state.progress;
      const audioDuration =
        audio && Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : state.duration;

      const position = Math.max(0, overrides?.position ?? audioPosition ?? 0);
      const resolvedDuration = Math.max(
        0,
        overrides?.duration ?? (audioDuration || track.duration || 0)
      );

      void sendDiscordActivity({
        event,
        track,
        isPlaying: overrides?.isPlaying ?? state.isPlaying,
        progress: position,
        duration: resolvedDuration,
        sessionId: 'live',
        appId: discordAppId,
      });
    },
    [discordEnabled, jamSessionId, discordAppId]
  );

  const recoverDuration = useCallback(
    async (audio: any, track: Track) => {
      const source = audio.currentSrc || audio.src || track.url;
      if (!source) return;

      const probeKey = `${track.id}|${source}`;
      if (durationProbeRef.current.has(probeKey)) return;
      durationProbeRef.current.add(probeKey);

      const recovered = await readAudioDuration(source);
      if (!isUsableDuration(recovered)) return;

      const state = usePlayerStore.getState();
      if (state.currentTrack?.id !== track.id) return;

      const rounded = Math.round(recovered);
      setDuration(recovered);
      if (
        !isUsableDuration(state.currentTrack.duration) ||
        Math.abs(state.currentTrack.duration - rounded) > 1
      ) {
        state.updateTrack(track.id, { duration: rounded });
      }
    },
    [setDuration]
  );

  const seekTo = useCallback(
    (position: number) => {
      if (!Number.isFinite(position)) return;

      const audio = audioRef.current;
      const mediaDuration =
        audio && isUsableDuration(audio.duration) ? audio.duration : null;
      const storedDuration = usePlayerStore.getState().duration;
      const knownDuration = isUsableDuration(storedDuration)
        ? storedDuration
        : mediaDuration;
      const durationLimit = knownDuration ?? Number.POSITIVE_INFINITY;
      const nextPos = Math.max(0, Math.min(position, durationLimit));

      setProgress(nextPos);

      if (audio && audio.src) {
        try {
          audio.currentTime = nextPos;
        } catch {
          // Ignore while loading
        }
      }
    },
    [setProgress]
  );

  const reportAudioError = useCallback(
    (error?: unknown) => {
      const audio = audioRef.current;
      const mediaError = audio?.error;
      const code = mediaError?.code ?? 0;
      const detail =
        mediaError?.message ||
        (error instanceof Error ? error.message : typeof error === 'string' ? error : '') ||
        'The local audio file could not be played.';

      if (
        code === 1 ||
        (error instanceof DOMException && error.name === 'AbortError') ||
        /\babort(?:ed)?\b/i.test(detail)
      ) {
        return;
      }

      const codeLabel =
        code === 2
          ? 'network error'
          : code === 3
            ? 'decode error'
            : code === 4
              ? 'unsupported source'
              : 'playback error';
      const track = usePlayerStore.getState().currentTrack;
      const key = `${track?.id ?? ''}|${code}|${detail}`;
      if (lastAudioErrorRef.current === key) return;
      lastAudioErrorRef.current = key;
      showToast(`Audio playback failed (${codeLabel}): ${detail}`);
    },
    [showToast]
  );

  useEffect(() => {
    if (isUsableDuration(currentTrack?.duration)) {
      setDuration(currentTrack.duration);
    }
  }, [currentTrack?.id, currentTrack?.duration, setDuration]);

  useEffect(() => {
    if (currentTrack) {
      nativeAudio.setTrackMetadata({
        title: currentTrack.title || 'Aurora',
        artist: currentTrack.author || '',
        duration: Number(currentTrack.duration) || 0,
      });
    }
  }, [currentTrack]);

  // OS media controls
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;

    if (!currentTrack) {
      mediaSession.metadata = null;
      mediaSession.playbackState = 'none';
      return;
    }

    if (typeof MediaMetadata !== 'undefined') {
      mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown title',
        artist: currentTrack.author || 'Unknown artist',
        album: mediaAlbum(currentTrack),
        artwork: mediaArtwork(currentTrack),
      });
    }

    mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }
    if (!currentTrack) return;

    const mediaSession = navigator.mediaSession;
    if (typeof mediaSession.setPositionState !== 'function') return;

    const audio = audioRef.current;
    const total =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : duration;

    if (!Number.isFinite(total) || total <= 0) return;

    const position = Math.max(0, Math.min(progress, total));

    try {
      mediaSession.setPositionState({
        duration: total,
        playbackRate: audio?.playbackRate || 1,
        position,
      });
    } catch {}
  }, [currentTrack, progress, duration]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    const actions: MediaSessionAction[] = [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'seekto',
      'stop',
    ];

    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {}
    };

    const resume = () => {
      play();
      const audio = audioRef.current;
      if (audio && audio.paused && audio.src) {
        audio.play().catch(() => {});
      }
    };

    const pausePlayback = () => {
      pause();
      audioRef.current?.pause();
    };

    const seekBy = (offset: number) => {
      const audio = audioRef.current;
      const current =
        audio && Number.isFinite(audio.currentTime)
          ? audio.currentTime
          : usePlayerStore.getState().progress;
      seekTo(current + offset);
    };

    setHandler('play', resume);
    setHandler('pause', pausePlayback);
    setHandler('previoustrack', () => prev());
    setHandler('nexttrack', () => next());
    setHandler('seekbackward', (details) =>
      seekBy(-(details.seekOffset || MEDIA_SEEK_STEP_SECONDS))
    );
    setHandler('seekforward', (details) =>
      seekBy(details.seekOffset || MEDIA_SEEK_STEP_SECONDS)
    );
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        seekTo(details.seekTime);
      }
    });
    setHandler('stop', () => {
      pausePlayback();
      const audio = audioRef.current;
      if (audio) audio.currentTime = 0;
      setProgress(0);
    });

    return () => {
      for (const action of actions) {
        setHandler(action, null);
      }
    };
  }, [play, pause, prev, next, seekTo, setProgress]);

  // Load source on track change and immediately start playback if isPlaying is true
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    if (durationRecoveryTimerRef.current) {
      clearTimeout(durationRecoveryTimerRef.current);
      durationRecoveryTimerRef.current = null;
    }

    const generation = ++sourceGenerationRef.current;
    lastAudioErrorRef.current = '';
    prevTrackIdRef.current = currentTrackId;

    if (
      !currentTrackId ||
      currentTrackSource === 'imported' ||
      !currentTrackUrl
    ) {
      a.pause();
      a.src = '';
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      return;
    }

    a.pause();

    getCachedAudioUrl(currentTrackUrl).then((resolvedUrl) => {
      if (generation !== sourceGenerationRef.current || !a) return;

      const previousObjectUrl = objectUrlRef.current;
      if (a.src !== resolvedUrl) {
        a.src = resolvedUrl;
      } else {
        a.currentTime = 0;
      }

      objectUrlRef.current = resolvedUrl.startsWith('blob:') ? resolvedUrl : null;
      if (previousObjectUrl && previousObjectUrl !== resolvedUrl) {
        URL.revokeObjectURL(previousObjectUrl);
      }

      const storeState = usePlayerStore.getState();
      const vol = Math.max(0, Math.min(1, storeState.volume));
      a.muted = vol === 0;
      a.volume = vol;

      if (storeState.isPlaying) {
        const p = a.play();
        if (p && typeof p.catch === 'function') {
          p.catch((error: unknown) => {
            if (generation !== sourceGenerationRef.current) return;
            reportAudioError(error);
            usePlayerStore.getState().pause();
          });
        }
      }
    });

    return () => {
      sourceGenerationRef.current += 1;
    };
  }, [currentTrackId, currentTrackSource, currentTrackUrl, reportAudioError]);

  // Re-selecting the already-loaded track restarts playback cleanly from 00:00
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !currentTrackId || prevTrackIdRef.current !== currentTrackId) return;
    if (playNonce <= 0) return;

    setProgress(0);
    if (a.src) {
      a.currentTime = 0;
      if (usePlayerStore.getState().isPlaying && a.paused) {
        const p = a.play();
        if (p && typeof p.catch === 'function') {
          p.catch((error: unknown) => reportAudioError(error));
        }
      }
    }
  }, [playNonce, currentTrackId, setProgress, reportAudioError]);

  // Sync play/pause state with nativeAudio
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !currentTrackId || currentTrackSource === 'imported') return;

    if (!isPlaying) {
      if (!a.paused) a.pause();
      return;
    }

    if (a.src && a.paused) {
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          reportAudioError(error);
          usePlayerStore.getState().pause();
        });
      }
    }
  }, [isPlaying, currentTrackId, currentTrackSource, reportAudioError]);

  useEffect(() => {
    const a = audioRef.current;
    const clamped = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
    if (clamped > 0) {
      lastNonZeroVolumeRef.current = clamped;
    }
    if (!a) return;
    a.muted = clamped === 0;
    a.volume = clamped;
  }, [volume]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  // Audio event listeners
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => {
      if (isScrubbingRef.current) return;
      if (Number.isFinite(a.currentTime) && a.currentTime >= 0) {
        setProgress(a.currentTime);
      }
    };

    const onError = () => {
      if (!a.src) return;
      reportAudioError();
    };

    const onLoaded = () => {
      const state = usePlayerStore.getState();
      const track = state.currentTrack;
      const mediaDuration = isUsableDuration(a.duration) ? a.duration : null;
      const metadataDuration = isUsableDuration(track?.duration)
        ? track.duration
        : null;
      const initialDuration = mediaDuration ?? metadataDuration;
      if (initialDuration !== null) {
        setDuration(initialDuration);
      }

      const isLocalFile =
        !!track?.filePath ||
        (track?.url ?? '').startsWith('/api/media/') ||
        track?.source === 'cloud' ||
        track?.source === 'local';

      if (track && isLocalFile && initialDuration === null) {
        if (durationRecoveryTimerRef.current) {
          clearTimeout(durationRecoveryTimerRef.current);
        }
        durationRecoveryTimerRef.current = setTimeout(() => {
          durationRecoveryTimerRef.current = null;
          const current = usePlayerStore.getState();
          if (current.currentTrack?.id !== track.id) return;
          void recoverDuration(a, track);
        }, 400);
      }

      const loadedDuration = mediaDuration ?? metadataDuration ?? 0;

      if (
        discordEnabled &&
        track &&
        loadedDuration > 0 &&
        (!track.duration || Math.abs(track.duration - loadedDuration) > 1)
      ) {
        const durationKey = `${track.id}|${Math.round(loadedDuration)}`;
        if (loadedDurationKeyRef.current !== durationKey) {
          loadedDurationKeyRef.current = durationKey;
          pushPresence('sync', {
            position: a.currentTime || 0,
            duration: loadedDuration,
          });
        }
      }
    };

    const onEnd = () => {
      const state = usePlayerStore.getState();
      const { tracks, currentTrack, repeatMode, shuffle } = state;

      if (repeatMode === 'one') {
        a.currentTime = 0;
        a.play().catch(() => {});
        pushPresence('resume', { position: 0, isPlaying: true });
        return;
      }

      if (!currentTrack || tracks.length === 0) return;
      const playable = tracks.filter((track) => track.source !== 'imported');
      if (playable.length === 0) {
        state.pause();
        return;
      }
      const idx = playable.findIndex((t) => t.id === currentTrack.id);
      const isLast = idx === playable.length - 1;

      if (repeatMode === 'off' && !shuffle && isLast) {
        state.pause();
        return;
      }
      state.next();
    };

    const onSeeked = () => {
      setProgress(a.currentTime);

      if (seekSyncTimerRef.current) {
        clearTimeout(seekSyncTimerRef.current);
      }

      seekSyncTimerRef.current = setTimeout(() => {
        seekSyncTimerRef.current = null;
        pushPresence('seek', { position: a.currentTime });
      }, 350);
    };

    a.addEventListener('timeupdate', onTime);
    a.addEventListener('error', onError);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('durationchange', onLoaded);
    a.addEventListener('ended', onEnd);
    a.addEventListener('seeked', onSeeked);

    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('error', onError);
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('durationchange', onLoaded);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('seeked', onSeeked);

      if (seekSyncTimerRef.current) {
        clearTimeout(seekSyncTimerRef.current);
        seekSyncTimerRef.current = null;
      }
      if (durationRecoveryTimerRef.current) {
        clearTimeout(durationRecoveryTimerRef.current);
        durationRecoveryTimerRef.current = null;
      }
    };
  }, [
    setProgress,
    setDuration,
    discordEnabled,
    pushPresence,
    recoverDuration,
    reportAudioError,
  ]);

  // Discord Rich Presence event synchronization
  useEffect(() => {
    if (!discordEnabled) {
      presenceStateRef.current = {
        trackId: null,
        isPlaying: null,
        sessionId: null,
        appId: null,
      };
      return;
    }

    if (!currentTrack) {
      presenceStateRef.current = {
        trackId: null,
        isPlaying: null,
        sessionId: 'live',
        appId: discordAppId,
      };
      void clearDiscordActivity();
      return;
    }

    const previous = presenceStateRef.current;
    const currentSession = 'live';
    const trackChanged = previous.trackId !== currentTrack.id;
    const playChanged = previous.isPlaying !== isPlaying;
    const sessionChanged = previous.sessionId !== currentSession;
    const appIdChanged = previous.appId !== discordAppId;

    if (trackChanged) {
      pushPresence('track_change', {
        position: 0,
        duration: currentTrack.duration || 0,
        isPlaying,
      });
    } else if (playChanged) {
      pushPresence(isPlaying ? 'resume' : 'pause', { isPlaying });
    } else if (sessionChanged || appIdChanged) {
      pushPresence('sync');
    }

    presenceStateRef.current = {
      trackId: currentTrack.id,
      isPlaying,
      sessionId: currentSession,
      appId: discordAppId,
    };
  }, [
    currentTrack,
    isPlaying,
    discordEnabled,
    discordAppId,
    pushPresence,
  ]);

  useEffect(() => {
    if (!discordEnabled || !currentTrack || !isPlaying) return;

    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) return;
      pushPresence('sync', { position: audio.currentTime });
    }, 30000);

    return () => clearInterval(interval);
  }, [discordEnabled, currentTrack, isPlaying, pushPresence]);

  useEffect(() => {
    if (!discordEnabled) {
      void clearDiscordActivity();
    }
  }, [discordEnabled]);

  useEffect(() => {
    const handlePageHide = () => {
      if (discordEnabled) clearDiscordActivityBeacon();
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [discordEnabled]);

  useEffect(() => {
    if (!discordEnabled) {
      autoJamStartedRef.current = false;
    }
  }, [discordEnabled]);

  const handleSeek = seekTo;

  const safeDuration = isUsableDuration(duration) ? duration : 0;
  const pct =
    safeDuration > 0
      ? Math.min(100, Math.max(0, (progress / safeDuration) * 100))
      : 0;
  const totalLabel = safeDuration > 0 ? formatTime(safeDuration) : '--:--';

  return (
    <>
      <footer
        ref={footerRef}
        className="player-shell fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--term-border)] bg-[var(--term-bg-panel)] font-mono text-xs select-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-1 items-center gap-2.5 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* Now Playing Info */}
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-9 w-9 shrink-0 border border-[var(--term-border)] bg-[var(--term-bg-input)] overflow-hidden">
              {currentTrack?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentTrack.thumbnail}
                  alt=""
                  className="h-full w-full object-cover grayscale"
                />
              ) : (
                <div className="h-full w-full grid place-items-center text-[var(--term-text-muted)] font-bold text-xs">
                  ♪
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--term-text-bright)] truncate">
                {currentTrack ? currentTrack.title : '<! NO_TRACK_LOADED >'}
              </p>
              <p className="text-[11px] text-[var(--term-text-muted)] truncate">
                {currentTrack ? currentTrack.author : 'Ready to play'}
              </p>
            </div>
          </div>

          {/* Central Transport & Progress */}
          <div className="order-3 mx-auto flex w-full max-w-xl min-w-0 flex-col items-center gap-1.5 md:col-span-2 lg:order-none lg:col-span-1">
            <div className="flex items-center gap-2 justify-center">
              <button
                onClick={toggleShuffle}
                title={`Shuffle: ${shuffle ? 'ON' : 'OFF'}`}
                className={cn(
                  'px-2 py-0.5 border text-xs transition-none',
                  shuffle
                    ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] font-semibold'
                    : 'border-[var(--term-border)] text-[var(--term-text-muted)] hover:text-white'
                )}
              >
                [ SHUF ]
              </button>

              <button
                onClick={prev}
                title="Previous track"
                className="px-2.5 py-0.5 border border-[var(--term-border)] text-[var(--term-text)] hover:border-[var(--term-border-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] text-xs"
              >
                {'[ |<< ]'}
              </button>

              <button
                onClick={() => (isPlaying ? pause() : play())}
                title={isPlaying ? 'Pause' : 'Play'}
                className="px-3.5 py-0.5 border border-[var(--term-border-bright)] bg-[var(--term-bg-input)] text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] font-bold text-xs"
              >
                {isPlaying ? '[ PAUSE ]' : '[ PLAY ]'}
              </button>

              <button
                onClick={next}
                title="Next track"
                className="px-2.5 py-0.5 border border-[var(--term-border)] text-[var(--term-text)] hover:border-[var(--term-border-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)] text-xs"
              >
                {'[ >>| ]'}
              </button>

              <button
                onClick={cycleRepeatMode}
                title={`Repeat: ${repeatMode}`}
                className={cn(
                  'px-2 py-0.5 border text-xs transition-none',
                  repeatMode !== 'off'
                    ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] font-semibold'
                    : 'border-[var(--term-border)] text-[var(--term-text-muted)] hover:text-white'
                )}
              >
                {repeatMode === 'off' ? '[ REPEAT ]' : repeatMode === 'one' ? '[ REP: 1 ]' : '[ REP: ALL ]'}
              </button>
            </div>

            <div className="w-full flex items-center gap-2.5">
              <span className="text-[11px] text-[var(--term-text-muted)] tabular-nums shrink-0">
                {formatTime(progress)} / {totalLabel}
              </span>
              <div className="flex-1">
                <Slider
                  value={progress}
                  max={safeDuration > 0 ? safeDuration : 1}
                  step={0.1}
                  onChange={handleSeek}
                  onDragStateChange={(dragging) => {
                    isScrubbingRef.current = dragging;
                  }}
                  ariaLabel="Seek"
                />
              </div>
              <span className="text-[10px] text-[var(--term-text-dim)] tabular-nums shrink-0 w-8 text-right">
                {Math.round(pct)}%
              </span>
            </div>
          </div>

          {/* Volume, Lyrics, Fullscreen & Jam */}
          <div className="order-2 flex w-full min-w-0 flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap md:w-auto lg:order-none">

            <button
              onClick={() => setFullscreenOpen(true)}
              disabled={!currentTrack}
              className="shrink-0 whitespace-nowrap border border-[var(--term-border)] px-2 py-1 text-xs text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] disabled:opacity-30"
              title="Open fullscreen Now Playing"
            >
              [ FULL ]
            </button>

            {lyricsPluginEnabled && (
              <button
                onClick={() => setLyricsOpen(true)}
                disabled={!currentTrack}
                className="px-2 py-1 border border-[var(--term-border)] text-xs text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)] disabled:opacity-30 disabled:pointer-events-none"
              >
                [ LYRICS ]
              </button>
            )}

            <div className="flex shrink-0 items-center gap-1.5 border border-[var(--term-border)] bg-[var(--term-bg-input)] px-1.5 py-1 text-xs">
              <button
                onClick={() =>
                  setVolume(volume > 0 ? 0 : lastNonZeroVolumeRef.current || 0.8)
                }
                title={volume > 0 ? 'Mute' : 'Unmute'}
                aria-label={volume > 0 ? 'Mute' : 'Unmute'}
                className="w-8 text-left text-[var(--term-text-muted)] hover:text-[var(--term-text-bright)]"
              >
                {volume > 0 ? 'VOL' : 'MUTE'}
              </button>
              <VolumeSlider value={volume} onChange={setVolume} />
              <span className="w-7 text-right text-[10px] tabular-nums text-[var(--term-text-muted)]">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </div>
      </footer>

      <LyricsPanel
        open={lyricsPluginEnabled && lyricsOpen}
        onClose={() => setLyricsOpen(false)}
      />
      <NowPlayingScreen
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
      />
    </>
  );
}
