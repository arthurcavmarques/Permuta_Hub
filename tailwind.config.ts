import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { colors, fonts, radius, shadows } from './src/design/tokens';

// Cada token vira variável CSS (--color-x) e classe Tailwind (bg-x, text-x, border-x).
const cssVars = Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--color-${k}`, v]));
const twColors = Object.fromEntries(Object.keys(colors).map((k) => [k, `var(--color-${k})`]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: { ...twColors, transparent: 'transparent', current: 'currentColor' },
    fontFamily: { sans: fonts.sans },
    borderRadius: { none: '0', ...radius, full: '9999px', DEFAULT: radius.md },
    extend: { boxShadow: shadows },
  },
  plugins: [plugin(({ addBase }) => addBase({ ':root': cssVars }))],
} satisfies Config;
