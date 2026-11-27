import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'var(--font-mono)',
          'JetBrains Mono',
          'Fira Code',
          'IBM Plex Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
        sans: [
          'var(--font-mono)',
          'JetBrains Mono',
          'Fira Code',
          'IBM Plex Mono',
          'ui-monospace',
          'monospace',
        ],
      },
      colors: {
        term: {
          bg: 'var(--term-bg)',
          panel: 'var(--term-bg-panel)',
          input: 'var(--term-bg-input)',
          hover: 'var(--term-bg-hover)',
          border: 'var(--term-border)',
          'border-bright': 'var(--term-border-bright)',
          text: 'var(--term-text)',
          'text-bright': 'var(--term-text-bright)',
          'text-muted': 'var(--term-text-muted)',
          'text-dim': 'var(--term-text-dim)',
          accent: 'var(--term-accent)',
          'invert-bg': 'var(--term-invert-bg)',
          'invert-text': 'var(--term-invert-text)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
