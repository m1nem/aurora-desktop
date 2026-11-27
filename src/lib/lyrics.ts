import type { LyricsCandidate, LyricsProvider } from './api';
import type { Track } from '@/types';

export const LYRICS_PROVIDERS: Array<{
  id: LyricsProvider;
  label: string;
  synchronized: boolean;
}> = [
  { id: 'lrclib', label: 'LRCLIB (synced)', synchronized: true },
  { id: 'lyricsovh', label: 'Lyrics.ovh (plain)', synchronized: false },
];

export interface LyricLine {
  time: number;
  text: string;
}

export function lyricsTrackKey(track: Track | null | undefined): string {
  if (!track) return '';
  return `${track.author.trim().toLowerCase()}\u0000${track.title
    .trim()
    .toLowerCase()}`;
}

export function providerLabel(provider: LyricsProvider): string {
  return LYRICS_PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

/**
 * Parses common LRC files. Multiple timestamps per line and [offset:] tags are
 * supported; metadata-only tags are ignored. Returns [] for plain lyrics.
 */
// AURORA_FIX_LYRICS_LIB_V1
export function parseLrc(value: string | null | undefined): LyricLine[] {
  if (!value) return [];
  let offset = 0;
  const lines: LyricLine[] = [];
  const stampRe = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const raw of value.split(/\r?\n/)) {
    const offsetMatch = raw.match(/^\[offset:([+-]?\d+)\]/i);
    if (offsetMatch) {
      offset = Number(offsetMatch[1]) / 1000;
      continue;
    }

    const stamps = Array.from(raw.matchAll(stampRe));
    if (stamps.length === 0) continue;
    const text = raw.replace(stampRe, '').trim();
    if (!text || /^\[[a-z]+:.*\]$/i.test(text)) continue;

    for (const match of stamps) {
      const hours = match[1] ? Number(match[1]) : 0;
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const fractionRaw = match[4] ?? '0';
      const fraction =
        fractionRaw.length === 3
          ? Number(fractionRaw) / 1000
          : Number(fractionRaw.padEnd(2, '0')) / 100;
      const time = hours * 3600 + minutes * 60 + seconds + fraction + offset;
      if (Number.isFinite(time) && time >= 0) lines.push({ time, text });
    }
  }

  return lines.sort((left, right) => left.time - right.time);
}

/** Returns the last line whose timestamp is <= position, or -1. */
export function activeLineIndex(lines: LyricLine[], position: number): number {
  if (lines.length === 0 || !Number.isFinite(position)) return -1;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= position + 0.08) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

export function candidateLabel(candidate: LyricsCandidate): string {
  const duration =
    typeof candidate.duration === 'number' && candidate.duration > 0
      ? ` · ${Math.floor(candidate.duration / 60)}:${String(
          Math.floor(candidate.duration % 60)
        ).padStart(2, '0')}`
      : '';
  const sync = candidate.syncedLyrics ? 'SYNCED' : 'PLAIN';
  return `${candidate.trackName} — ${candidate.artistName}${duration} [${sync}]`;
}

export function bestCandidate(
  candidates: LyricsCandidate[]
): LyricsCandidate | null {
  return (
    candidates.find((candidate) => Boolean(candidate.syncedLyrics)) ??
    candidates[0] ??
    null
  );
}
