import { expect, test } from '@playwright/test';

// Aceite da Fase 0 contra PRODUÇÃO: no celular, filtrar e abrir o dossiê cego de ≥10 áreas.
// Só leitura: não revela dado sensível (isso gravaria no access_log, que é append-only).
const email = process.env.ACEITE_EMAIL;
const password = process.env.ACEITE_PASSWORD;

test('celular: filtra e abre o dossiê cego de 10 áreas', async ({ page }) => {
  test.skip(!email || !password, 'Defina ACEITE_EMAIL e ACEITE_PASSWORD');
  test.setTimeout(180_000);

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email!);
  await page.getByLabel('Senha').fill(password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Oportunidades' })).toBeVisible();
  await expect(page.getByText('24 áreas')).toBeVisible();

  await page.getByLabel('Região, bairro ou cidade').fill('zona sul');
  await page.getByLabel('Área mín. (m²)').fill('5000');
  await expect(page.getByText('5 áreas')).toBeVisible();
  await page.screenshot({ path: 'test-results/prod/lista-filtrada.png' });
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByText('24 áreas')).toBeVisible();

  const mds = (await page.getByRole('link', { name: /MD-\d{3}/ }).allTextContents())
    .map((t) => t.match(/MD-\d{3}/)![0])
    .slice(0, 10);
  expect(mds).toHaveLength(10);

  for (const md of mds) {
    await page.getByRole('link', { name: new RegExp(md) }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('m²');
    await expect(page.getByText(md).first()).toBeVisible();
    await expect(page.getByText(/MAT-\d{3}-FICT/)).toHaveCount(0);
    if (md === mds[0]) {
      // Evidência do primeiro dossiê com o mapa. Sem fullPage: esticar o canvas WebGL a ~4.600 px
      // esgota a memória de vídeo do Chromium headless e derruba a página.
      await page.waitForTimeout(3000);
      await page.getByRole('img', { name: 'Localização aproximada' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/prod/dossie-${md}.png` });
    }
    await page.goBack();
    await expect(page.getByText('24 áreas')).toBeVisible();
  }
});
