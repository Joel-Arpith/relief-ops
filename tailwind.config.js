/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        void: '#04060B',
        abyss: '#070A12',
        ink: '#0B1018',
        hair: 'rgba(255,255,255,0.08)',
        neon: {
          cyan: '#22D3EE',
          ice: '#7DD3FC',
          violet: '#A855F7',
          ember: '#FF6B2C',
          crimson: '#FF3B4E',
          amber: '#FBBF24',
          mint: '#34D399',
        },
        observed: '#94A3B8',
        inferred: '#C084FC',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 64px -24px rgba(0,0,0,0.9)',
        neon: '0 0 0 1px rgba(34,211,238,0.25), 0 0 32px -6px rgba(34,211,238,0.45)',
        ember: '0 0 0 1px rgba(255,107,44,0.3), 0 0 36px -8px rgba(255,107,44,0.6)',
      },
      backdropBlur: { xs: '2px' },
      keyframes: {
        driftA: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(6%,-4%,0) scale(1.12)' } },
        driftB: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1.05)' }, '50%': { transform: 'translate3d(-7%,5%,0) scale(0.95)' } },
        sweep: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(1200%)' } },
        breathe: { '0%,100%': { opacity: '0.55' }, '50%': { opacity: '1' } },
        riseIn: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        driftA: 'driftA 28s ease-in-out infinite',
        driftB: 'driftB 34s ease-in-out infinite',
        sweep: 'sweep 7s linear infinite',
        breathe: 'breathe 2.6s ease-in-out infinite',
        riseIn: 'riseIn 0.5s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
};
