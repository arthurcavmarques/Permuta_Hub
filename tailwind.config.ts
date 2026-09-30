import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { colors, fonts, radius, shadows } from './src/design/tokens';

// Cada token vira variável CSS (--color-x, em canais RGB "15 42 63") e classe Tailwind
// (bg-x, text-x, border-x), com suporte a opacidade (bg-x/10).
const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const cssVars = Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--color-${k}`, channels(v)]));
const twColors = Object.fromEntries(
  Object.keys(colors).map((k) => [k, `rgb(var(--color-${k}) / <alpha-value>)`]),
);

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
