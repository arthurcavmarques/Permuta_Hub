/**
 * ÚNICA fonte da identidade visual (provisória). O designer substitui este arquivo
 * e a plataforma inteira muda: o tailwind.config lê daqui e publica cada cor como
 * variável CSS (--color-<nome>). Nunca use cor hard-coded em componente.
 */
export const colors = {
  primary: '#0F2A3F', // azul-marinho: cabeçalhos, fundos institucionais, títulos
  'primary-foreground': '#FFFFFF',
  action: '#0E7C7B', // verde-petróleo: botões, links, estados ativos
  'action-hover': '#0B6564',
  'action-foreground': '#FFFFFF',
  accent: '#C9A24B', // dourado: só sobre fundo escuro ou como preenchimento. PROIBIDO como texto sobre claro.
  'accent-text-on-light': '#8A6A1F',
  bg: '#F4F6F7',
  surface: '#FFFFFF',
  border: '#E3E7E9',
  muted: '#5B6B75',
  ink: '#242A2E',
  // Status: todos com contraste AA (≥ 4,5:1) como texto sobre branco — ver tokens.test.ts
  success: '#1E7A4C',
  'success-bg': '#E6F4EC',
  warning: '#8A5300',
  'warning-bg': '#FDF3E1',
  danger: '#B42318',
  'danger-bg': '#FDECEA',
  info: '#1F5F99',
  'info-bg': '#E8F0F8',
  neutral: '#5B6B75',
  'neutral-bg': '#EEF1F2',
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
};

export const radius = { sm: '4px', md: '6px', lg: '10px' };

export const shadows = {
  card: '0 1px 2px rgba(15, 42, 63, 0.06), 0 1px 3px rgba(15, 42, 63, 0.08)',
  raised: '0 4px 12px rgba(15, 42, 63, 0.12)',
};

/** Pares texto/fundo que precisam passar AA; usados pelo teste de contraste. */
export const contrastPairs: Array<[ColorToken, ColorToken]> = [
  ['primary', 'surface'],
  ['action', 'surface'],
  ['action-foreground', 'action'],
  ['muted', 'surface'],
  ['muted', 'bg'],
  ['ink', 'bg'],
  ['accent', 'primary'],
  ['accent-text-on-light', 'surface'],
  ['success', 'success-bg'],
  ['warning', 'warning-bg'],
  ['danger', 'danger-bg'],
  ['info', 'info-bg'],
  ['neutral', 'neutral-bg'],
];
