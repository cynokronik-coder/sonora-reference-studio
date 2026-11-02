/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07080a',
          900: '#0b0c0f',
          850: '#101216',
          800: '#15181d',
          750: '#1a1e24',
          700: '#20252c',
          600: '#2b313a',
          500: '#3a424d',
          400: '#5a6472',
          300: '#86909e',
          200: '#b4bdc8',
          100: '#dde3ea',
        },
        accent: {
          DEFAULT: '#c8f169',
          dim: '#9fc44a',
          glow: 'rgba(200,241,105,0.16)',
        },
        signal: {
          red: '#f2657a',
          amber: '#f0b45a',
          cyan: '#5ad1e6',
          violet: '#a78bfa',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '13px', letterSpacing: '0.04em' }],
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 40px -20px rgba(0,0,0,0.9)',
      },
    },
  },
  plugins: [],
};
