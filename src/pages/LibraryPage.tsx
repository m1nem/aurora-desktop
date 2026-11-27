// AURORA_PATCH: Library page v3 - Clean CLI aesthetics
'use client';

import { TrackList } from '@/components/TrackList';
import { ImportButton } from '@/components/ImportButton';
import { RecoverButton } from '@/components/RecoverButton';

export default function LibraryPage() {
  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-[var(--term-text-bright)]">
            Music Library
          </h1>
          <p className="text-[var(--term-text-muted)] text-xs mt-1 leading-relaxed">
            All locally indexed audio tracks, downloaded MP3s, and uploaded files.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <RecoverButton />
          <ImportButton />
        </div>
      </div>

      <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-4">
        <TrackList results={null} mode="library" allowRemove />
      </div>
    </div>
  );
}
