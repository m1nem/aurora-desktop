// AURORA_PATCH: theme presets & player customization v1

export type ThemeId =
  | 'green'
  | 'cool'
  | 'amber'
  | 'crimson'
  | 'violet'
  | 'paper';

export type LegacyThemeId = 'dark' | 'light';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  description: string;
  background: string;
  accent: string;
  fontSize: number;
  swatches: string[];
}

export interface PlayerCustomization {
  background: string;
  accentColor: string;
  fontSize: number;
}

export const THEMES: ThemePreset[] = [
  {
    id: 'green',
    name: 'Green Phosphor',
    description: 'Classic monochrome terminal with neon phosphor green.',
    background: '#0a0e0a',
    accent: '#22c55e',
    fontSize: 16,
    swatches: ['#0a0e0a', '#111812', '#234428', '#22c55e'],
  },
  {
    id: 'cool',
    name: 'Cool Monospace',
    description: 'Frost cyan and ice blue on deep developer slate.',
    background: '#0d1117',
    accent: '#38bdf8',
    fontSize: 16,
    swatches: ['#0d1117', '#161b22', '#30363d', '#38bdf8'],
  },
  {
    id: 'amber',
    name: 'Amber CRT',
    description: 'Warm amber phosphor for late-night terminal sessions.',
    background: '#120d08',
    accent: '#f59e0b',
    fontSize: 16,
    swatches: ['#120d08', '#1c150d', '#4a3415', '#f59e0b'],
  },
  {
    id: 'crimson',
    name: 'Crimson Night',
    description: 'High-contrast red terminal with a dark industrial mood.',
    background: '#100809',
    accent: '#ef4444',
    fontSize: 16,
    swatches: ['#100809', '#1b0e10', '#4c1d24', '#ef4444'],
  },
  {
    id: 'violet',
    name: 'Ultraviolet',
    description: 'Violet accents over a deep purple-black workspace.',
    background: '#0c0914',
    accent: '#a78bfa',
    fontSize: 16,
    swatches: ['#0c0914', '#151022', '#3b2d63', '#a78bfa'],
  },
  {
    id: 'paper',
    name: 'Paper Mono',
    description: 'A light, high-contrast paper theme for bright rooms.',
    background: '#f5f2e8',
    accent: '#0f766e',
    fontSize: 16,
    swatches: ['#f5f2e8', '#fffdf7', '#c9c2ad', '#0f766e'],
  },
];

export const DEFAULT_THEME: ThemeId = 'green';

export const DEFAULT_PLAYER_CUSTOMIZATION: PlayerCustomization =
  customizationForTheme(DEFAULT_THEME);

export function customizationForTheme(theme: ThemeId): PlayerCustomization {
  const preset = THEMES.find((item) => item.id === theme) ?? THEMES[0];
  return {
    background: preset.background,
    accentColor: preset.accent,
    fontSize: preset.fontSize,
  };
}

export function normalizeTheme(value: unknown): ThemeId {
  if (value === 'dark') return 'green';
  if (value === 'light') return 'cool';
  return THEMES.some((theme) => theme.id === value)
    ? (value as ThemeId)
    : DEFAULT_THEME;
}

export function themeById(theme: ThemeId): ThemePreset {
  return THEMES.find((item) => item.id === theme) ?? THEMES[0];
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim());
}

export function normalizeFontSize(value: unknown, fallback = 16): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(20, Math.max(12, parsed)));
}

export function normalizeCustomization(
  value: unknown,
  fallback: PlayerCustomization = DEFAULT_PLAYER_CUSTOMIZATION
): PlayerCustomization {
  const raw = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

  return {
    background: isHexColor(raw.background)
      ? raw.background.trim()
      : fallback.background,
    accentColor: isHexColor(raw.accentColor)
      ? raw.accentColor.trim()
      : fallback.accentColor,
    fontSize: normalizeFontSize(raw.fontSize, fallback.fontSize),
  };
}

export function hexToRgb(value: string): [number, number, number] | null {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;

  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function toHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map(toHex).join('')}`;
}

export function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;

  const ratio = Math.min(1, Math.max(0, amount));
  return rgbToHex([
    a[0] + (b[0] - a[0]) * ratio,
    a[1] + (b[1] - a[1]) * ratio,
    a[2] + (b[2] - a[2]) * ratio,
  ]);
}

function relativeLuminance(value: string): number {
  const rgb = hexToRgb(value);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkColor(value: string): boolean {
  return relativeLuminance(value) < 0.45;
}

/**
 * Pick the foreground (black or white) with the better WCAG contrast ratio.
 * A plain luminance threshold fails on saturated colors such as neon green.
 */
export function readableTextColor(background: string): '#ffffff' | '#000000' {
  const luminance = relativeLuminance(background);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#ffffff';
}
