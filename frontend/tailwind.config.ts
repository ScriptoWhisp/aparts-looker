import type { Config } from 'tailwindcss'

const config: Config = {
  // Apply dark class on <html> (dark-first, Nocturne palette)
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // ── Nocturne palette ──────────────────────────────────────────────────
      // Source: SPEC.md §1 + tokens.css
      colors: {
        // Ground & chrome
        bg:      '#0f111c',   // page canvas, deepest background
        app:     '#161826',   // app/body background
        sunken:  '#1d1f2d',   // cards, panels, inset wells
        surface: '#232532',   // raised: sheets, dialogs, hero card
        border: {
          DEFAULT: '#292b31', // hairlines
          strong:  '#3f424d', // visible borders
        },
        // Text hierarchy
        text: {
          DEFAULT: '#e9e9ed',  // primary text
          2:       '#cfd3e5',  // body copy, verdicts
          3:       '#9397ab',  // secondary / placeholder
        },
        muted: '#75798c',      // labels, axis ticks
        faint: '#595d6c',      // disabled, hints

        // Accent (Nocturne purple)
        accent: {
          DEFAULT: '#9184d9',  // accent base
          lt:      '#b5abfc',  // accent text on dark — use this for labels
        },

        // Score ramp — information signal only (never flood fill)
        score: {
          bad:  '#c4635f',   //  0–39
          weak: '#c98b52',   // 40–59
          mid:  '#c9b455',   // 60–74
          good: '#7fbf7a',   // 75–84
          best: '#4fb98d',   // 85–100
        },

        // Status colours
        status: {
          new:     '#d9a473',  // pending / new listings
          short:   '#6fc9a3',  // shortlisted / approved
          skip:    '#d4827e',  // skipped / rejected
          viewing: '#93aee0',  // viewing scheduled
          viewed:  '#75798c',  // viewed / muted
        },
      },

      // ── Typography ────────────────────────────────────────────────────────
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },

      // ── Radius (4-based matches SPEC) ────────────────────────────────────
      borderRadius: {
        sm: '4px',   // chips, tiny pills
        md: '6px',   // buttons, inputs
        lg: '8px',   // cards
        xl: '14px',  // hero card, large modals
      },

      // ── Motion ────────────────────────────────────────────────────────────
      transitionTimingFunction: {
        spec: 'cubic-bezier(.2,.7,.3,1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '160ms',
      },

      // ── Box shadows (Nocturne dark-tuned) ────────────────────────────────
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,.4)',
        md: '0 4px 12px rgba(0,0,0,.45)',
        lg: '0 10px 30px rgba(0,0,0,.5)',
        hairline: 'inset 0 0 0 1px #292b31',
        'hairline-strong': 'inset 0 0 0 1px #3f424d',
      },
    },
  },
  plugins: [],
}

export default config
