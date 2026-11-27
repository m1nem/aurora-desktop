'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { nativeAudio } from '@/lib/nativeAudio';
import { usePlayerStore } from '@/store/usePlayerStore';
import {
  fetchBestLyricsForTrack,
  type LrclibCandidate,
  type LyricsFetchResult,
} from '@/lib/lyricsClient';
import { cn, formatTime } from '@/lib/utils';

export interface WordTiming {
  text: string;
  trailingSpace: string;
  start: number;
  end: number;
}

export interface LyricLine {
  id: string;
  time: number;
  endTime: number;
  text: string;
  words: WordTiming[];
  isInstrumental?: boolean;
}

interface LyricsViewProps {
  lyrics?: string | null;
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  onSeek?: (time: number) => void;
  className?: string;
  compact?: boolean;
}

const VOWEL_GROUP_RE = /[aeiouyąęóAEIOUYĄĘÓàáâãäåèéêëìíîïòôõöùúûü]+/g;
const LINE_TAG_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG_RE = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>\s*([^<]+)/g;
const OFFSET_TAG_RE = /^\[offset:\s*([+-]?\d+)\s*\]$/i;
const META_TAG_RE = /^\[(ar|ti|al|au|by|re|ve|length):.*\]$/i;

function parseTimestamp(minStr: string, secStr: string, fracStr?: string): number {
  const mins = parseInt(minStr, 10) || 0;
  const secs = parseInt(secStr, 10) || 0;
  if (!fracStr) return mins * 60 + secs;
  const padded = fracStr.padEnd(3, '0').slice(0, 3);
  const ms = parseInt(padded, 10) || 0;
  return mins * 60 + secs + ms / 1000;
}

function estimateWordTimings(
  text: string,
  lineStart: number,
  rawLineEnd: number
): WordTiming[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const tokens = trimmed.match(/\S+\s*/g) || [trimmed];
  const nonSpaceChars = trimmed.replace(/\s+/g, '').length;
  const wordCount = tokens.length;

  const rawGap = Math.max(0.3, rawLineEnd - lineStart);
  const naturalSpan = Math.max(1.0, nonSpaceChars * 0.125 + wordCount * 0.14);
  const effectiveDuration =
    rawGap > naturalSpan * 1.8 && rawGap > 4.2
      ? Math.min(rawGap * 0.85, naturalSpan * 1.4)
      : rawGap * 0.96;

  const weights = tokens.map((tok) => {
    const clean = tok.trim();
    const core = clean.replace(/[^\p{L}\p{N}]/gu, '');
    const coreLen = Math.max(1, core.length);
    const vowelGroups = (clean.match(VOWEL_GROUP_RE) || []).length;
    const punctPause = /[.!?…]$/.test(clean)
      ? 0.85
      : /[,;:\-—]$/.test(clean)
        ? 0.45
        : 0;
    return Math.max(0.55, coreLen * 0.7 + vowelGroups * 0.6 + punctPause);
  });

  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;
  let cursor = lineStart;

  return tokens.map((tok, idx) => {
    const match = tok.match(/^(\S+)(\s*)$/);
    const wordText = match ? match[1] : tok.trim();
    const trailingSpace = match ? match[2] : ' ';
    const slice = (weights[idx] / totalWeight) * effectiveDuration;
    const start = cursor;
    const end = idx === tokens.length - 1 ? lineStart + effectiveDuration : cursor + slice;
    cursor = end;

    return {
      text: wordText,
      trailingSpace,
      start,
      end: Math.max(start + 0.05, end),
    };
  });
}

function parseEnhancedWords(
  rawBody: string,
  lineStart: number,
  lineEnd: number
): WordTiming[] | null {
  const matches = Array.from(rawBody.matchAll(WORD_TAG_RE));
  if (matches.length === 0) return null;

  const items: WordTiming[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = parseTimestamp(m[1], m[2], m[3]);
    const nextStart =
      i + 1 < matches.length
        ? parseTimestamp(matches[i + 1][1], matches[i + 1][2], matches[i + 1][3])
        : lineEnd;
    const tokenMatch = m[4].match(/^(\S+)(\s*)$/);
    const wordText = tokenMatch ? tokenMatch[1] : m[4].trim();
    const trailingSpace = tokenMatch ? tokenMatch[2] : ' ';
    if (!wordText) continue;
    items.push({
      text: wordText,
      trailingSpace: trailingSpace || ' ',
      start,
      end: Math.max(start + 0.06, nextStart),
    });
  }
  return items.length > 0 ? items : null;
}

export function parseLyricsWithWordSync(
  raw: string | null | undefined,
  totalDuration: number
): { lines: LyricLine[]; isEstimated: boolean } {
  if (!raw || !raw.trim()) {
    return { lines: [], isEstimated: false };
  }

  const rawLines = raw.split(/\r?\n/);
  let offsetSec = 0;
  const timedEntries: { time: number; body: string }[] = [];
  const plainLines: string[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const offsetMatch = trimmed.match(OFFSET_TAG_RE);
    if (offsetMatch) {
      offsetSec = (parseInt(offsetMatch[1], 10) || 0) / 1000;
      continue;
    }

    if (META_TAG_RE.test(trimmed)) {
      continue;
    }

    const tags = Array.from(trimmed.matchAll(LINE_TAG_RE));
    if (tags.length > 0) {
      const body = trimmed.replace(LINE_TAG_RE, '').trim();
      for (const tag of tags) {
        const t = Math.max(0, parseTimestamp(tag[1], tag[2], tag[3]) + offsetSec);
        timedEntries.push({ time: t, body });
      }
    } else {
      plainLines.push(trimmed);
    }
  }

  if (timedEntries.length > 0) {
    timedEntries.sort((a, b) => a.time - b.time);
    const lines: LyricLine[] = [];

    for (let i = 0; i < timedEntries.length; i++) {
      const entry = timedEntries[i];
      const nextTime =
        i + 1 < timedEntries.length
          ? timedEntries[i + 1].time
          : totalDuration > entry.time
            ? totalDuration
            : entry.time + 4.5;

      const cleanText = entry.body.replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim();
      const isInstrumental = !cleanText || /^[♪♫•·\-~]+$/.test(cleanText);
      const displayText = isInstrumental ? '♪  •  •  •' : cleanText;

      const enhanced = isInstrumental
        ? null
        : parseEnhancedWords(entry.body, entry.time, nextTime);
      const words = isInstrumental
        ? []
        : enhanced ?? estimateWordTimings(displayText, entry.time, nextTime);

      lines.push({
        id: `lrc-${i}-${entry.time.toFixed(3)}`,
        time: entry.time,
        endTime: Math.max(entry.time + 0.25, nextTime),
        text: displayText,
        words,
        isInstrumental,
      });
    }

    return { lines, isEstimated: false };
  }

  if (plainLines.length > 0) {
    const safeDur = totalDuration > 5 ? totalDuration : plainLines.length * 3.5;
    const introPad = Math.min(2.0, safeDur * 0.04);
    const usableDur = Math.max(plainLines.length * 1.5, safeDur - introPad * 1.5);
    const charWeights = plainLines.map((l) => Math.max(4, l.length));
    const totalChars = charWeights.reduce((a, b) => a + b, 0) || 1;

    let cursor = introPad;
    const lines: LyricLine[] = plainLines.map((text, idx) => {
      const span = (charWeights[idx] / totalChars) * usableDur;
      const start = cursor;
      const end = cursor + span;
      cursor = end;
      return {
        id: `plain-${idx}`,
        time: start,
        endTime: end,
        text,
        words: estimateWordTimings(text, start, end),
      };
    });

    return { lines, isEstimated: true };
  }

  return { lines: [], isEstimated: false };
}

function vocalEase(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const smooth =
    clamped < 0.5
      ? 2 * clamped * clamped
      : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
  return clamped * 0.55 + smooth * 0.45;
}

export const LyricsView: React.FC<LyricsViewProps> = ({
  lyrics: lyricsProp,
  currentTime: currentTimeProp,
  duration: durationProp,
  isPlaying: isPlayingProp,
  onSeek: onSeekProp,
  className,
  compact = false,
}) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const storeProgress = usePlayerStore((s) => s.progress);
  const storeDuration = usePlayerStore((s) => s.duration);
  const storeIsPlaying = usePlayerStore((s) => s.isPlaying);
  const setProgress = usePlayerStore((s) => s.setProgress);

  const [fetchedResult, setFetchedResult] = useState<LyricsFetchResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const nativeDur =
    Number.isFinite(nativeAudio.duration) && nativeAudio.duration > 0
      ? nativeAudio.duration
      : 0;

  const duration =
    (typeof durationProp === 'number' && durationProp > 0 ? durationProp : 0) ||
    nativeDur ||
    (storeDuration > 0 ? storeDuration : 0) ||
    (currentTrack?.duration || 0);

  const roundedDuration = duration > 0 ? Math.round(duration) : 0;

  const propLyrics =
    typeof lyricsProp === 'string' && lyricsProp.trim().length > 0
      ? lyricsProp.trim()
      : null;

  const embeddedLyrics = useMemo(() => {
    const t = currentTrack as any;
    const raw = t?.syncedLyrics || t?.lyrics;
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }, [currentTrack]);

  // Automatically query LRCLIB (matching closest to exact MP3 duration) + fallback API
  useEffect(() => {
    setPickerOpen(false);

    if (!currentTrack) {
      setFetchedResult(null);
      setSelectedCandidateId(null);
      setLoading(false);
      return;
    }

    if (propLyrics) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    fetchBestLyricsForTrack(currentTrack, duration, {
      forceRefresh: retryNonce > 0,
      signal: controller.signal,
    })
      .then((res) => {
        if (!active || controller.signal.aborted) return;
        setFetchedResult(res);
        setSelectedCandidateId(res?.candidates?.[0]?.id ?? null);
        setLoading(false);

        if (res?.lyrics) {
          const st = usePlayerStore.getState();
          if (
            st.currentTrack?.id === currentTrack.id &&
            typeof st.updateTrack === 'function'
          ) {
            st.updateTrack(currentTrack.id, { lyrics: res.lyrics } as any);
          }
        }
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.author, roundedDuration, propLyrics, retryNonce]);

  const activeCandidate: LrclibCandidate | null = useMemo(() => {
    if (!fetchedResult?.candidates?.length) return null;
    if (selectedCandidateId !== null) {
      const found = fetchedResult.candidates.find((c) => c.id === selectedCandidateId);
      if (found) return found;
    }
    return fetchedResult.candidates[0];
  }, [fetchedResult, selectedCandidateId]);

  const rawLyrics =
    propLyrics ??
    (activeCandidate
      ? activeCandidate.syncedLyrics || activeCandidate.plainLyrics || ''
      : fetchedResult?.lyrics ?? embeddedLyrics ?? '');

  const isPlaying = isPlayingProp ?? storeIsPlaying;
  const baseProgress = currentTimeProp ?? storeProgress;

  // 60fps smooth clock anchored to nativeAudio.currentTime for fluid letter-by-letter animation
  const [smoothTime, setSmoothTime] = useState<number>(baseProgress);
  const anchorRef = useRef<{ time: number; perf: number }>({
    time: baseProgress,
    perf: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  useEffect(() => {
    const live =
      Number.isFinite(nativeAudio.currentTime) && nativeAudio.currentTime > 0
        ? nativeAudio.currentTime
        : baseProgress;
    anchorRef.current = {
      time: live,
      perf: performance.now(),
    };
    setSmoothTime(live);
  }, [baseProgress, currentTrack?.id]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;

    const tick = () => {
      const now = performance.now();
      const elapsed = (now - anchorRef.current.perf) / 1000;
      const predicted =
        anchorRef.current.time + Math.min(0.28, Math.max(0, elapsed));
      setSmoothTime(predicted);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  const { lines, isEstimated } = useMemo(
    () => parseLyricsWithWordSync(rawLyrics, duration),
    [rawLyrics, duration]
  );

  const activeLineIndex = useMemo(() => {
    if (lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (smoothTime + 0.04 >= lines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [lines, smoothTime]);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const userScrollingUntilRef = useRef<number>(0);

  useEffect(() => {
    if (activeLineIndex < 0 || !activeLineRef.current) return;
    if (Date.now() < userScrollingUntilRef.current) return;

    activeLineRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeLineIndex]);

  const handleSeekTime = (targetTime: number) => {
    const clamped = Math.max(0, targetTime);
    if (onSeekProp) {
      onSeekProp(clamped);
      return;
    }
    setProgress(clamped);
    if (nativeAudio.src) {
      nativeAudio.currentTime = clamped;
    }
    anchorRef.current = { time: clamped, perf: performance.now() };
    setSmoothTime(clamped);
  };

  if (loading && lines.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full text-center p-6 font-mono text-xs text-[var(--term-text-muted)] select-none',
          className
        )}
      >
        <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] px-4 py-3 space-y-1">
          <p className="text-[var(--term-border-bright)] font-semibold animate-pulse">
            {'[ SEARCHING LRCLIB... ]'}
          </p>
          <p className="text-[11px] text-[var(--term-text-dim)]">
            {duration > 0
              ? `Matching LRC closest to ${formatTime(duration)}`
              : 'Querying LRCLIB & fallback lyrics API'}
          </p>
        </div>
      </div>
    );
  }

  if (!rawLyrics || lines.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center h-full text-center p-6 font-mono text-xs text-[var(--term-text-muted)] select-none',
          className
        )}
      >
        <div className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] px-4 py-3 space-y-2">
          <p className="text-[var(--term-text-bright)] font-semibold">
            {'<! NO_LYRICS_AVAILABLE >'}
          </p>
          <p className="text-[11px] text-[var(--term-text-dim)]">
            No synced .lrc or plain lyrics found on LRCLIB or fallback API.
          </p>
          {currentTrack && (
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="px-2.5 py-1 border border-[var(--term-border)] text-[10px] text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
            >
              [ RETRY SEARCH ]
            </button>
          )}
        </div>
      </div>
    );
  }

  const allCandidates = fetchedResult?.candidates ?? [];
  const matchedDur = activeCandidate?.duration || activeCandidate?.lastTimestamp || 0;
  const durDelta =
    activeCandidate?.durationDiff !== null && activeCandidate?.durationDiff !== undefined
      ? activeCandidate.durationDiff
      : null;

  return (
    <div
      ref={containerRef}
      onWheel={() => {
        userScrollingUntilRef.current = Date.now() + 3500;
      }}
      onTouchMove={() => {
        userScrollingUntilRef.current = Date.now() + 3500;
      }}
      className={cn(
        'relative h-full overflow-y-auto px-4 sm:px-8 py-6 font-mono select-none scroll-smooth',
        className
      )}
    >
      {/* Match & Duration Telemetry Bar */}
      <div className="mx-auto max-w-2xl mb-5 flex flex-wrap items-center justify-center gap-2 text-[10px] text-[var(--term-text-dim)]">
        <span className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] px-2 py-0.5 uppercase">
          {activeCandidate?.source === 'lyrics.ovh'
            ? 'FALLBACK API • PLAIN'
            : isEstimated
              ? 'PLAIN • ESTIMATED SYNC'
              : 'LRCLIB • WORD & LETTER SYNC'}
        </span>

        {matchedDur > 0 && (
          <span className="border border-[var(--term-border)] bg-[var(--term-bg-panel)] px-2 py-0.5 tabular-nums">
            LRC {formatTime(matchedDur)}
            {durDelta !== null ? ` (Δ ${durDelta.toFixed(1)}s)` : ''}
          </span>
        )}

        {allCandidates.length > 1 && (
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="border border-[var(--term-border)] bg-[var(--term-bg-input)] px-2 py-0.5 text-[var(--term-text-muted)] hover:border-[var(--term-border-bright)] hover:text-[var(--term-text-bright)]"
          >
            {pickerOpen
              ? '[ HIDE MATCHES ]'
              : `[ ${allCandidates.length} MATCHES ]`}
          </button>
        )}
      </div>

      {/* Optional LRC Version Picker (sorted by closest duration to local MP3) */}
      {pickerOpen && allCandidates.length > 1 && (
        <div className="mx-auto max-w-2xl mb-6 border border-[var(--term-border)] bg-[var(--term-bg-panel)] p-2 space-y-1 text-[11px]">
          <div className="px-2 py-1 text-[10px] text-[var(--term-text-dim)] border-b border-[var(--term-border)] flex justify-between">
            <span>LRCLIB CANDIDATES (SORTED BY CLOSEST LENGTH)</span>
            {duration > 0 && <span>TRACK: {formatTime(duration)}</span>}
          </div>
          {allCandidates.slice(0, 8).map((cand) => {
            const isSelected = activeCandidate?.id === cand.id;
            const cDur = cand.duration || cand.lastTimestamp || 0;
            return (
              <button
                key={cand.id}
                type="button"
                onClick={() => {
                  setSelectedCandidateId(cand.id);
                  setPickerOpen(false);
                }}
                className={cn(
                  'w-full text-left px-2 py-1.5 border flex items-center justify-between gap-2 transition-none',
                  isSelected
                    ? 'border-[var(--term-border-bright)] bg-[var(--term-invert-bg)] text-[var(--term-invert-text)] font-semibold'
                    : 'border-transparent text-[var(--term-text-muted)] hover:border-[var(--term-border)] hover:text-[var(--term-text-bright)]'
                )}
              >
                <span className="truncate">
                  {cand.artistName ? `${cand.artistName} — ` : ''}
                  {cand.trackName}
                  {cand.albumName ? ` (${cand.albumName})` : ''}
                </span>
                <span className="shrink-0 tabular-nums text-[10px]">
                  {cand.syncedLyrics ? '[LRC]' : '[TXT]'}{' '}
                  {cDur > 0 ? formatTime(cDur) : '--:--'}
                  {cand.durationDiff !== null
                    ? ` Δ${cand.durationDiff.toFixed(1)}s`
                    : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mx-auto max-w-2xl space-y-3 sm:space-y-4 pb-24">
        {lines.map((line, lineIdx) => {
          const isActive = lineIdx === activeLineIndex;
          const isPast = activeLineIndex !== -1 && lineIdx < activeLineIndex;

          return (
            <div
              key={line.id}
              ref={isActive ? activeLineRef : undefined}
              onClick={() => handleSeekTime(line.time)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSeekTime(line.time);
                }
              }}
              title={`Seek to ${formatTime(line.time)}`}
              className={cn(
                'group relative rounded px-3 py-1.5 cursor-pointer transition-all duration-200 border-l-2',
                isActive
                  ? 'border-[var(--term-border-bright)] bg-[var(--term-bg-panel)]/70 scale-[1.01] shadow-[0_0_24px_rgba(0,0,0,0.35)]'
                  : 'border-transparent hover:border-[var(--term-border)] hover:bg-[var(--term-bg-panel)]/35',
                compact
                  ? 'text-sm sm:text-base'
                  : 'text-base sm:text-xl leading-relaxed'
              )}
            >
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    'text-[10px] tabular-nums shrink-0 transition-colors',
                    isActive
                      ? 'text-[var(--term-border-bright)] font-bold'
                      : 'text-[var(--term-text-dim)] opacity-60 group-hover:opacity-100'
                  )}
                >
                  {formatTime(line.time)}
                </span>

                <div className="flex-1 flex flex-wrap items-baseline">
                  {!isActive || line.words.length === 0 ? (
                    <span
                      className={cn(
                        'transition-colors duration-200',
                        isActive
                          ? 'text-[var(--term-border-bright)] font-bold animate-pulse'
                          : isPast
                            ? 'text-[var(--term-text-muted)] opacity-55 group-hover:opacity-90'
                            : 'text-[var(--term-text-dim)] opacity-75 group-hover:text-[var(--term-text)] group-hover:opacity-100'
                      )}
                    >
                      {line.text}
                    </span>
                  ) : (
                    line.words.map((word, wIdx) => {
                      const wordDur = Math.max(0.05, word.end - word.start);
                      const rawWordProgress = (smoothTime - word.start) / wordDur;
                      const isWordSung = rawWordProgress >= 1;
                      const isWordActive =
                        rawWordProgress >= 0 && rawWordProgress < 1;
                      const easedProgress = vocalEase(rawWordProgress);
                      const chars = Array.from(word.text);
                      const activeCharIdx = isWordActive
                        ? Math.min(
                            chars.length - 1,
                            Math.max(0, Math.floor(easedProgress * chars.length))
                          )
                        : -1;

                      return (
                        <span
                          key={`${line.id}-w-${wIdx}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSeekTime(word.start);
                          }}
                          className={cn(
                            'inline-flex items-baseline whitespace-pre transition-transform duration-100 rounded-xs',
                            isWordActive &&
                              'scale-[1.03] px-0.5 -mx-0.5 bg-[var(--term-bg-hover)]/60'
                          )}
                        >
                          <span className="inline-flex items-baseline">
                            {chars.map((ch, cIdx) => {
                              const charThreshold =
                                (cIdx + 0.45) / Math.max(1, chars.length);
                              const isCharSung =
                                isWordSung ||
                                (isWordActive && easedProgress >= charThreshold);
                              const isCurrentChar =
                                isWordActive && cIdx === activeCharIdx;

                              return (
                                <span
                                  key={cIdx}
                                  style={
                                    isCurrentChar
                                      ? {
                                          textShadow:
                                            '0 0 12px var(--term-border-bright)',
                                        }
                                      : isCharSung
                                        ? {
                                            textShadow:
                                              '0 0 6px rgba(255,255,255,0.22)',
                                          }
                                        : undefined
                                  }
                                  className={cn(
                                    'inline-block transition-all duration-75',
                                    isCurrentChar
                                      ? 'text-[var(--term-border-bright)] font-extrabold -translate-y-[1.5px] scale-110'
                                      : isCharSung
                                        ? 'text-[var(--term-text-bright)] font-semibold'
                                        : 'text-[var(--term-text-muted)] opacity-65'
                                  )}
                                >
                                  {ch}
                                </span>
                              );
                            })}
                          </span>
                          {word.trailingSpace && <span>{word.trailingSpace}</span>}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LyricsView;
