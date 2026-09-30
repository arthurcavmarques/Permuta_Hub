import { colors, contrastPairs } from './tokens';
import { contrastRatio } from './contrast';

describe('tokens de cor', () => {
  it.each(contrastPairs)('%s sobre %s passa WCAG AA (4,5:1)', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('dourado sobre branco reprova (não pode ser usado como texto)', () => {
    expect(contrastRatio(colors.accent, colors.surface)).toBeLessThan(4.5);
  });
});
