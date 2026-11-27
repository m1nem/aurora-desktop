import { invoke } from '@tauri-apps/api/core';

const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    await invoke('open_external_url', { url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function installExternalLinkInterceptor(): void {
  if (typeof window === 'undefined' || !isTauri()) return;

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        void openExternalUrl(href);
      }
    },
    true
  );

  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const str = typeof url === 'string' ? url : url?.toString() ?? '';
    if (/^https?:\/\//i.test(str)) {
      void openExternalUrl(str);
      return null;
    }
    return nativeOpen(url, target, features);
  }) as typeof window.open;
}
