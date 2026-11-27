// AURORA_PATCH: runtime theme + custom CSS injector v1
'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  isDarkColor,
  mixHex,
  readableTextColor,
} from '@/lib/themes';

const CUSTOM_CSS_ID = 'aurora-custom-css';

function cssVar(name: string, value: string): [string, string] {
  return [`--${name}`, value];
}

export function ThemeInjector() {
  const theme = useSettingsStore((state) => state.theme);
  const customization = useSettingsStore((state) => state.playerCustomization);
  const customCss = useSettingsStore((state) => state.customCss);

  useEffect(() => {
    const root = document.documentElement;
    const background = customization.background;
    const accent = customization.accentColor;
    const dark = isDarkColor(background);
    const text = dark ? '#f1f5f9' : '#111827';
    const accentText = readableTextColor(accent);
    const panel = mixHex(background, text, 0.065);
    const input = dark
      ? mixHex(background, '#000000', 0.34)
      : mixHex(background, '#ffffff', 0.62);
    const hover = mixHex(background, accent, 0.13);
    const border = mixHex(background, accent, 0.24);

    root.setAttribute('data-theme', theme);
    root.style.colorScheme = dark ? 'dark' : 'light';

    const variables: Array<[string, string]> = [
      cssVar('term-bg', background),
      cssVar('term-bg-panel', panel),
      cssVar('term-bg-input', input),
      cssVar('term-bg-hover', hover),
      cssVar('term-border', border),
      cssVar('term-border-bright', accent),
      cssVar('term-text', text),
      cssVar('term-text-bright', dark ? '#ffffff' : '#000000'),
      cssVar('term-text-muted', mixHex(text, background, 0.34)),
      cssVar('term-text-dim', mixHex(text, background, 0.52)),
      cssVar('term-invert-bg', accent),
      cssVar('term-invert-text', accentText),
      cssVar('term-accent', accent),
      cssVar('term-tag-bg', mixHex(background, accent, 0.14)),
      cssVar('term-selection-bg', accent),
      cssVar('term-selection-text', accentText),
    ];

    for (const [name, value] of variables) {
      root.style.setProperty(name, value);
    }

    root.style.fontSize = `${customization.fontSize}px`;
  }, [theme, customization]);

  useEffect(() => {
    let style = document.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = CUSTOM_CSS_ID;
      style.setAttribute('data-aurora-custom-css', 'true');
      document.head.appendChild(style);
    }

    style.textContent = customCss;
  }, [customCss]);

  return null;
}
