/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy ink tokens now map to Sonora's navy/violet surface scale.
        ink: {
          950: '#090914',
          900: '#0D0D1B',
          850: '#11111F',
          800: '#171727',
          750: '#1D1D30',
          700: '#252538',
          600: '#303047',
          500: '#4A4961',
          400: '#85849C',
          300: '#B9B7C9',
          200: '#D8D5E4',
          100: '#F5F3FA',
        },
        accent: {
          DEFAULT: '#8957FF',
          dim: '#7545EA',
          bright: '#A77AFF',
          glow: 'rgba(137,87,255,0.20)',
        },
        signal: {
          red: '#EF686D',
          amber: '#E6AD3D',
          cyan: '#55B7EA',
          violet: '#A77AFF',
          green: '#80D66E',
          lime: '#8EDB75',
        },
        sonora: {
          canvas: '#090914',
          background: '#0D0D1B',
          surface: '#11111F',
          raised: '#171727',
          elevated: '#1D1D30',
          interactive: '#252538',
          border: '#303047',
          purple: '#7545EA',
          violet: '#8957FF',
          lavender: '#A77AFF',
          pale: '#C4A2FF',
          lime: '#8EDB75',
          blue: '#55B7EA',
          green: '#80D66E',
          amber: '#E6AD3D',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '3xs': ['9px', { lineHeight: '12px', letterSpacing: '0.04em' }],
        '2xs': ['10px', { lineHeight: '13px', letterSpacing: '0.035em' }],
      },
      borderRadius: {
        panel: '18px',
        card: '14px',
        control: '11px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.035) inset, 0 16px 44px -24px rgba(0,0,0,0.78)',
        floating: '0 18px 52px -22px rgba(0,0,0,0.82), 0 0 0 1px rgba(255,255,255,0.025)',
        violet: '0 8px 28px -12px rgba(117,69,234,0.52)',
        'violet-soft': '0 0 24px rgba(137,87,255,0.16)',
      },
      backdropBlur: {
        glass: '16px',
      },
      transitionDuration: {
        180: '180ms',
        220: '220ms',
      },
    },
  },
  plugins: [],
};
