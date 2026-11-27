// AURORA_PATCH: client-side audio duration fallback v1
// Browser metadata parsing is not reliable for every uploaded MP3. Some files
// have VBR frames without a Xing/Info header, so Chrome/Safari may report a
// duration of 0, NaN, or Infinity. Decoding the audio buffer gives us the real
// duration and lets the player persist it for the next session.

export function isUsableDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;

  const legacyWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return window.AudioContext || legacyWindow.webkitAudioContext || null;
}

/**
 * Decodes an audio URL with the Web Audio API and returns its duration.
 * Returns null when the browser cannot decode the file or the network request
 * fails. The caller should keep a known-good duration in that case.
 */
export async function readAudioDuration(url: string): Promise<number | null> {
  if (!url) return null;

  const AudioContextClass = audioContextConstructor();
  if (!AudioContextClass) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let context: AudioContext | null = null;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return null;

    context = new AudioContextClass();
    const decoded = await context.decodeAudioData(buffer.slice(0));
    return isUsableDuration(decoded.duration) ? decoded.duration : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    if (context && context.state !== 'closed') {
      context.close().catch(() => {});
    }
  }
}
