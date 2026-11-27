import { useEffect } from 'react';
import { apiTakeStartupAudio } from '@/lib/api';
import { usePlayerStore } from '@/store/usePlayerStore';
import { useToastStore } from '@/store/useToastStore';

let requested = false;

/** Imports audio files passed by the desktop file manager, once, on startup. */
// AURORA_FIX_STARTUP_FILES_V1
export function StartupFiles() {
  useEffect(() => {
    if (requested) return;
    requested = true;
    const timer = window.setTimeout(() => {
      void apiTakeStartupAudio()
      .then(({ tracks }) => {
        if (!tracks.length) return;
        const store = usePlayerStore.getState();
        store.addTracks(tracks);
        store.setCurrentTrack(tracks[0]);
        useToastStore
          .getState()
          .showToast(`Opened ${tracks.length === 1 ? tracks[0].title : `${tracks.length} audio files`}.`);
      })
      .catch((error: unknown) => {
        useToastStore
          .getState()
          .showToast(
            `Could not open the selected audio file: ${
              error instanceof Error ? error.message : 'unknown error'
            }`
          );
      });
    }, 100);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
