import { convertFileSrc } from '@tauri-apps/api/core';
import type { Track } from '@/types';
import { isTauri } from './api';

/**
 * Resolves a track to a URL the WebView can play.
 *
 * Local files returned by Rust carry an absolute `filePath`; those are
 * converted to Tauri's asset protocol URL (which supports HTTP range
 * requests, so seeking works). Remote/blob URLs are passed through.
 */
export function trackMediaUrl(track: Track | null | undefined): string {
  if (!track) return '';
  return mediaUrlFromPath(track.filePath, track.url);
}

export function mediaUrlFromPath(
  filePath?: string | null,
  fallbackUrl?: string | null
): string {
  if (filePath && isTauri()) {
    try {
      return convertFileSrc(filePath);
    } catch {
      return filePath;
    }
  }
  const url = fallbackUrl ?? '';
  return url;
}

/** True for Tauri asset-protocol URLs (which WebKitGTK cannot feed to media). */
export function isTauriAssetUrl(url: string): boolean {
  return (
    url.startsWith('asset:') ||
    url.startsWith('http://asset.localhost/') ||
    url.startsWith('https://asset.localhost/')
  );
}

/** True for URLs whose response is local and already range-served. */
export function isLocalMediaUrl(url: string): boolean {
  return (
    isTauriAssetUrl(url) ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  );
}

/**
 * A shareable link for the current desktop route. The app uses a hash router,
 * so the hash must be preserved.
 */
export function shareLink(path: string): string {
  if (typeof window === 'undefined') return path;
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#${path.startsWith('/') ? path : `/${path}`}`;
}
