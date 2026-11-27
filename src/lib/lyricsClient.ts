import type { Track } from '@/types';

export interface LrclibCandidate {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  lastTimestamp: number | null;
  durationDiff: number | null;
  score: number;
  source: 'lrclib' | 'lyrics.ovh';
}

export interface LyricsFetchResult {
  lyrics: string;
  isSynced: boolean;
  source: 'lrclib' | 'lyrics.ovh' | 'embedded';
  matchedDuration: number | null;
  durationDiff: number | null;
  candidates: LrclibCandidate[];
}

const CACHE_PREFIX = 'aurora_lyrics_v2:';
const memoryCache = new Map<string, LyricsFetchResult>();

const LINE_TS_RE = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function extractLastTimestamp(lrc: string | null | undefined): number | null {
  if (!lrc) return null;
  let maxTs: number | null = null;
  for (const m of lrc.matchAll(LINE_TS_RE)) {
    const mins = parseInt(m[1], 10) || 0;
    const secs = parseInt(m[2], 10) || 0;
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) || 0 : 0;
    const total = mins * 60 + secs + ms / 1000;
    if (maxTs === null || total > maxTs) {
      maxTs = total;
    }
  }
  return maxTs;
}

function cleanTrackStrings(track: Track): {
  title: string;
  artist: string;
  album: string;
  rawTitle: string;
  rawArtist: string;
} {
  let rawTitle = (track.title || '').trim();
  let rawArtist = (track.author || '').trim();
  const album = (track.album || '').trim();

  // Strip common audio file extensions
  rawTitle = rawTitle.replace(/\.(mp3|flac|wav|ogg|m4a|opus|aac|wma)$/i, '').trim();
  // Strip leading track numbers like "01 - " or "01. "
  rawTitle = rawTitle.replace(/^\d{1,3}\s*[-._)]\s+/, '').trim();

  // If artist is missing/generic and title looks like "Artist - Title", split it
  if (
    (!rawArtist || /^unknown(\s+artist)?$/i.test(rawArtist)) &&
    rawTitle.includes(' - ')
  ) {
    const parts = rawTitle.split(' - ');
    if (parts.length >= 2 && parts[0].trim().length > 0) {
      rawArtist = parts[0].trim();
      rawTitle = parts.slice(1).join(' - ').trim();
    }
  }

  const stripNoise = (s: string) =>
    s
      .replace(
        /[\[(]\s*(?:official\s*(?:music\s*)?(?:video|audio|visualizer|lyric\s*video)|lyrics?|hd|hq|320\s*kbps|flac|explicit|clean|remastered(?:\s*\d{4})?|audio)\s*[\])]/gi,
        ''
      )
      .replace(/\s{2,}/g, ' ')
      .trim();

  const title = stripNoise(rawTitle) || rawTitle;
  const artist = /^unknown(\s+artist)?$/i.test(rawArtist) ? '' : stripNoise(rawArtist);

  return { title, artist, album, rawTitle, rawArtist };
}

function tokenize(str: string): Set<string> {
  const clean = str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = clean.split(/\s+/).filter((t) => t.length >= 2);
  return new Set(tokens);
}

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const tok of setA) {
    if (setB.has(tok)) overlap++;
  }
  return (2 * overlap) / (setA.size + setB.size);
}

function scoreCandidate(
  raw: any,
  queryTitle: string,
  queryArtist: string,
  targetDuration: number
): LrclibCandidate | null {
  const syncedLyrics =
    typeof raw?.syncedLyrics === 'string' && raw.syncedLyrics.trim().length > 0
      ? raw.syncedLyrics.trim()
      : null;
  const plainLyrics =
    typeof raw?.plainLyrics === 'string' && raw.plainLyrics.trim().length > 0
      ? raw.plainLyrics.trim()
      : null;

  if (!syncedLyrics && !plainLyrics) {
    return null;
  }

  const trackName = String(raw?.trackName || raw?.name || '').trim();
  const artistName = String(raw?.artistName || '').trim();
  const albumName = String(raw?.albumName || '').trim();
  const candDuration =
    typeof raw?.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0
      ? raw.duration
      : 0;
  const lastTimestamp = extractLastTimestamp(syncedLyrics);

  let score = 0;

  // 1. Strongly prefer timestamped .lrc over plain text
  if (syncedLyrics) {
    score += 1000;
  } else {
    score += 220;
  }

  // 2. Duration proximity scoring (closest to the MP3's total length wins)
  let durationDiff: number | null = null;
  if (targetDuration > 0 && candDuration > 0) {
    durationDiff = Math.abs(candDuration - targetDuration);

    if (durationDiff <= 1.0) {
      score += 650;
    } else if (durationDiff <= 2.5) {
      score += 560 - durationDiff * 25;
    } else if (durationDiff <= 6.0) {
      score += 450 - durationDiff * 22;
    } else if (durationDiff <= 15.0) {
      score += 300 - durationDiff * 12;
    } else if (durationDiff <= 35.0) {
      score += 120 - durationDiff * 4;
    } else {
      // Heavy penalty for mismatched versions (e.g., radio edit vs 5:41 extended/album track)
      score -= durationDiff * 3.5;
    }
  } else if (targetDuration > 0 && lastTimestamp !== null) {
    // Fallback if LRCLIB duration metadata is 0: compare final LRC timestamp to track end
    const endGap = targetDuration - lastTimestamp;
    durationDiff = Math.abs(endGap);
    if (endGap >= -1.5 && endGap <= 25) {
      score += 320 - Math.abs(endGap - 4) * 8;
    } else if (endGap < -2) {
      score -= 220;
    }
  }

  // 3. Sanity check: synced LRC timestamps shouldn't run significantly past the MP3's end
  if (targetDuration > 0 && lastTimestamp !== null) {
    if (lastTimestamp > targetDuration + 3.5) {
      score -= (lastTimestamp - targetDuration) * 18;
    }
  }

  // 4. Title & Artist relevance so unrelated songs with identical length don't win
  const titleSim = textSimilarity(queryTitle, trackName);
  const artistSim = queryArtist ? textSimilarity(queryArtist, artistName) : 0.5;
  score += titleSim * 260 + artistSim * 180;

  if (titleSim < 0.15 && artistSim < 0.15) {
    score -= 400;
  }

  return {
    id: Number(raw?.id) || Math.floor(Math.random() * 1e9),
    trackName,
    artistName,
    albumName,
    duration: candDuration,
    instrumental: Boolean(raw?.instrumental),
    plainLyrics,
    syncedLyrics,
    lastTimestamp,
    durationDiff,
    score,
    source: 'lrclib',
  };
}

async function fetchJsonSafe(url: string, signal?: AbortSignal): Promise<any | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchFromFallbackApi(
  artist: string,
  title: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (!artist || !title) return null;
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const data = await fetchJsonSafe(url, signal);
  if (data && typeof data.lyrics === 'string' && data.lyrics.trim().length > 0) {
    return data.lyrics.trim();
  }
  return null;
}

function readPersistedCache(key: string): LyricsFetchResult | null {
  if (memoryCache.has(key)) {
    return memoryCache.get(key)!;
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LyricsFetchResult;
    if (parsed && typeof parsed.lyrics === 'string' && parsed.lyrics.trim().length > 0) {
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch {}
  return null;
}

function writePersistedCache(key: string, value: LyricsFetchResult): void {
  memoryCache.set(key, value);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {}
}

export async function fetchBestLyricsForTrack(
  track: Track,
  exactDuration: number,
  options?: { forceRefresh?: boolean; signal?: AbortSignal }
): Promise<LyricsFetchResult | null> {
  const targetDur =
    Number.isFinite(exactDuration) && exactDuration > 0
      ? exactDuration
      : Number.isFinite(track.duration) && track.duration > 0
        ? track.duration
        : 0;

  const { title, artist, album, rawTitle, rawArtist } = cleanTrackStrings(track);
  if (!title) return null;

  const durBucket = targetDur > 0 ? Math.round(targetDur) : 0;
  const cacheKey = `${track.id}|${title.toLowerCase()}|${artist.toLowerCase()}|${durBucket}`;

  if (!options?.forceRefresh) {
    const cached = readPersistedCache(cacheKey);
    if (cached) return cached;
  }

  const signal = options?.signal;
  const requests: Promise<any | null>[] = [];

  // 1. Structured LRCLIB search (returns all duration variants so we can pick the closest one)
  if (artist) {
    const p1 = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) p1.set('album_name', album);
    requests.push(fetchJsonSafe(`https://lrclib.net/api/search?${p1.toString()}`, signal));

    // Also try without album in case album tag differs from LRCLIB
    if (album) {
      const p1NoAlbum = new URLSearchParams({ track_name: title, artist_name: artist });
      requests.push(fetchJsonSafe(`https://lrclib.net/api/search?${p1NoAlbum.toString()}`, signal));
    }

    // Exact /api/get with rounded duration
    const pGet = new URLSearchParams({ track_name: title, artist_name: artist });
    if (durBucket > 0) pGet.set('duration', String(durBucket));
    requests.push(fetchJsonSafe(`https://lrclib.net/api/get?${pGet.toString()}`, signal));
  }

  // 2. General query search (catches featured artists, swapped tags, or partial metadata)
  const combinedQuery = artist ? `${artist} ${title}` : title;
  const pQuery = new URLSearchParams({ q: combinedQuery });
  requests.push(fetchJsonSafe(`https://lrclib.net/api/search?${pQuery.toString()}`, signal));

  // If cleaned title differed from rawTitle, also search rawTitle
  if (rawTitle && rawTitle.toLowerCase() !== title.toLowerCase()) {
    const rawQ = rawArtist ? `${rawArtist} ${rawTitle}` : rawTitle;
    requests.push(
      fetchJsonSafe(
        `https://lrclib.net/api/search?${new URLSearchParams({ q: rawQ }).toString()}`,
        signal
      )
    );
  }

  const responses = await Promise.all(requests);
  if (signal?.aborted) return null;

  const byId = new Map<number, LrclibCandidate>();

  for (const res of responses) {
    if (!res) continue;
    const list = Array.isArray(res) ? res : [res];
    for (const item of list) {
      const scored = scoreCandidate(item, title, artist, targetDur);
      if (!scored) continue;
      const existing = byId.get(scored.id);
      if (!existing || scored.score > existing.score) {
        byId.set(scored.id, scored);
      }
    }
  }

  const candidates = Array.from(byId.values()).sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    const best = candidates[0];
    const lyrics = best.syncedLyrics || best.plainLyrics || '';
    if (lyrics) {
      const result: LyricsFetchResult = {
        lyrics,
        isSynced: Boolean(best.syncedLyrics),
        source: 'lrclib',
        matchedDuration: best.duration > 0 ? best.duration : best.lastTimestamp,
        durationDiff: best.durationDiff,
        candidates,
      };
      writePersistedCache(cacheKey, result);
      return result;
    }
  }

  // 3. Fallback secondary API (lyrics.ovh) if LRCLIB returned nothing
  const fallbackLyrics = await fetchFromFallbackApi(artist || rawArtist, title, signal);
  if (signal?.aborted) return null;

  if (fallbackLyrics) {
    const fallbackCand: LrclibCandidate = {
      id: -1,
      trackName: title,
      artistName: artist || rawArtist,
      albumName: album,
      duration: targetDur,
      instrumental: false,
      plainLyrics: fallbackLyrics,
      syncedLyrics: null,
      lastTimestamp: null,
      durationDiff: null,
      score: 100,
      source: 'lyrics.ovh',
    };
    const result: LyricsFetchResult = {
      lyrics: fallbackLyrics,
      isSynced: false,
      source: 'lyrics.ovh',
      matchedDuration: null,
      durationDiff: null,
      candidates: [fallbackCand],
    };
    writePersistedCache(cacheKey, result);
    return result;
  }

  return null;
}
