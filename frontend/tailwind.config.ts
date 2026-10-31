import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  // Hover styles only on devices that can hover, so taps on phones never leave a stuck state.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Fluid display steps: two or three sizes do the visible work.
        'display-xl': ['clamp(3.25rem, 10vw, 10rem)', { lineHeight: '0.86', letterSpacing: '-0.055em' }],
        'display-lg': ['clamp(2.5rem, 6vw, 5.5rem)', { lineHeight: '0.9', letterSpacing: '-0.05em' }],
        'display-md': ['clamp(1.75rem, 3.2vw, 2.75rem)', { lineHeight: '0.98', letterSpacing: '-0.04em' }],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        brass: { DEFAULT: 'hsl(var(--brass))', foreground: 'hsl(var(--brass-foreground))' },
        positive: 'hsl(var(--positive))',
        chart: 'hsl(var(--chart))',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        drawer: 'var(--ease-drawer)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        print: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 640ms var(--ease-out) both',
        print: 'print 220ms var(--ease-out) both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
