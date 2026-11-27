import { nativeAudio } from '@/lib/nativeAudio';
import { useEffect, useState, useCallback } from 'react';
import { usePlayerStore } from '@/store/usePlayerStore';
import { LyricsView } from './LyricsView';
import { Slider } from './ui/Slider';
import { VolumeSlider } from './ui/VolumeSlider';
import { formatTime } from '@/lib/utils';
import { isUsableDuration } from '@/lib/audioDuration';

interface NowPlayingScreenProps {
  open: boolean;
  onClose: () => void;
}

async function setWindowFullscreen(enabled: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return;
  } catch {
    // Browser fallback (vite preview / unsupported window permissions).
  }
  try {
    if (enabled && !document.fullscreenElement) {
    } else if (!enabled && document.fullscreenElement) {
    }
  } catch {
    // Fullscreen is best-effort; the overlay remains usable.
  }
}

export function NowPlayingScreen({ open, onClose }: NowPlayingScreenProps) {

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const setProgress = usePlayerStore((s) => s.setProgress);

  // AURORA_FIX_FULLSCREEN_PLAYER_V1
  useEffect(() => {
    if (!open) return;
    let enteredDomFullscreen = false;
    void setWindowFullscreen(true).then(() => {
      enteredDomFullscreen = Boolean(document.fullscreenElement);
    });

    const onFullscreenChange = () => {
      if (enteredDomFullscreen && !document.fullscreenElement) {
        onClose();
      }
    };

    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (event.key === 'Escape' || event.key === 'F11' || event.key.toLowerCase() === 'f') {
        event.preventDefault();
        onClose();
      } else if (event.key === ' ') {
        event.preventDefault();
        const state = usePlayerStore.getState();
        if (state.isPlaying) state.pause();
        else state.play();
      }
    };

        window.addEventListener('keydown', onKey);
    return () => {
            window.removeEventListener('keydown', onKey);
      void setWindowFullscreen(false);
    };
  }, [open, onClose]);

  if (!open) return null;

  const safeDuration = isUsableDuration(duration) ? duration : 0;
  const artwork = currentTrack?.thumbnail ?? '';
  const seekTo = (value: number) => {
    if (!Number.isFinite(value)) return;
    const limit = safeDuration > 0 ? safeDuration : Number.POSITIVE_INFINITY;
    const clamped = Math.max(0, Math.min(value, limit));
    const audio = nativeAudio;
    if (audio) {
      try {
        audio.currentTime = clamped;
      } catch {
        // Metadata may still be loading.
      }
    }
    setProgress(clamped);
  };

  return (
    <div className={`fixed inset-x-0 bottom-0 top-9 z-[150] flex flex-col overflow-hidden bg-[var(--term-bg)] font-mono text-[var(--term-text)]`}>
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--term-border)] px-4 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--term-text-muted)]">
            AuroraMP / Now Playing
          </div>
          <div className="truncate text-sm font-semibold text-[var(--term-text-bright)]">
            {currentTrack?.title ?? 'No track loaded'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="border border-[var(--term-border)] px-3 py-1 text-xs text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
        >
          [ EXIT FULLSCREEN · ESC ]
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto landscape:grid landscape:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] landscape:overflow-hidden">
        <section className="flex shrink-0 flex-col items-center justify-center gap-3 border-b border-[var(--term-border)] p-4 landscape:min-h-0 landscape:gap-4 landscape:overflow-y-auto landscape:border-b-0 landscape:border-r">
          <div className="aspect-square w-full max-w-[min(28vh,16rem)] shrink-0 border border-[var(--term-border)] bg-[var(--term-bg-input)] landscape:max-w-[min(48vh,28rem)]">
            {artwork ? (
              <img src={artwork} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-5xl text-[var(--term-text-dim)]">
                ♪
              </div>
            )}
          </div>

          <div className="w-full max-w-xl text-center">
            <h1 className="truncate text-xl font-bold text-[var(--term-text-bright)]">
              {currentTrack?.title ?? 'Nothing playing'}
            </h1>
            <p className="truncate text-sm text-[var(--term-text-muted)]">
              {currentTrack?.author ?? 'Choose a track in the library'}
            </p>
          </div>

          <div className="flex w-full max-w-xl flex-col gap-2">
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={prev}
                className="border border-[var(--term-border)] px-3 py-1 text-xs text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
              >
                [ |&lt;&lt; ]
              </button>
              <button
                type="button"
                onClick={() => (isPlaying ? pause() : play())}
                className="border border-[var(--term-border-bright)] bg-[var(--term-bg-input)] px-5 py-1.5 text-sm font-bold text-[var(--term-text-bright)] hover:bg-[var(--term-invert-bg)] hover:text-[var(--term-invert-text)]"
              >
                {isPlaying ? '[ PAUSE ]' : '[ PLAY ]'}
              </button>
              <button
                type="button"
                onClick={next}
                className="border border-[var(--term-border)] px-3 py-1 text-xs text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
              >
                [ &gt;&gt;| ]
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-12 text-right text-[11px] tabular-nums text-[var(--term-text-muted)]">
                {formatTime(progress)}
              </span>
              <Slider
                value={progress}
                max={safeDuration > 0 ? safeDuration : 1}
                step={0.1}
                onChange={seekTo}
                ariaLabel="Seek in fullscreen player"
              />
              <span className="w-12 text-[11px] tabular-nums text-[var(--term-text-muted)]">
                {safeDuration > 0 ? formatTime(safeDuration) : '--:--'}
              </span>
            </div>

            <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-[var(--term-text-muted)]">
              <span>VOL</span>
              <VolumeSlider value={volume} onChange={setVolume} className="w-28" />
              <span className="w-9 text-right tabular-nums">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </section>

        <section className="flex min-h-[15rem] flex-1 flex-col p-3 landscape:min-h-0">
          <LyricsView className="min-h-0 flex-1" />
        </section>
      </main>
    </div>
  );
}
