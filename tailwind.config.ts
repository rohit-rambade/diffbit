import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        borderx: 'var(--border)',
        borderx2: 'var(--border2)',
        textx: 'var(--text)',
        mutedx: 'var(--muted)',
        mutedx2: 'var(--muted2)',
      },
    },
  },
  plugins: [],
} satisfies Config
