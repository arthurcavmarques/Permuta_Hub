import { expect, test, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@permutahub.local', password: 'admin-local-123' };
const COMUM = { email: 'usuario@permutahub.local', password: 'usuario-local-123' };

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('sem login, qualquer rota leva ao login', async ({ page }) => {
  await page.goto('/oportunidades');
  await expect(page).toHaveURL(/\/entrar/);
});

test('senha errada mostra erro', async ({ page }) => {
  await login(page, { ...ADMIN, password: 'errada-123456' });
  await expect(page.getByRole('alert')).toContainText('incorretos');
});

test('admin filtra e abre dossiê cego; dado sensível só aparece sob demanda', async ({ page }, info) => {
  await login(page, ADMIN);
  await expect(page.getByRole('heading', { name: 'Oportunidades' })).toBeVisible();
  // 25 no seed, 1 arquivada fora da lista
  await expect(page.getByText('24 áreas')).toBeVisible();
  await page.waitForTimeout(1500); // tiles do mapa
  await page.screenshot({ path: `test-results/shots/${info.project.name}-lista.png`, fullPage: false });

  await page.getByLabel('Região, bairro ou cidade').fill('zona sul');
  await page.getByLabel('Área mín. (m²)').fill('5000');
  await expect(page.getByText('5 áreas')).toBeVisible();
  await expect(page).toHaveURL(/regiao=zona\+sul/);

  if (info.project.name === 'celular') {
    await page.getByRole('tab', { name: 'Mapa' }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/shots/${info.project.name}-mapa.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Lista' }).click();
  }

  await page.getByRole('link', { name: /MD-005/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('12.400 m²');
  await expect(page.getByText('Cristal · Porto Alegre · RS')).toBeVisible();

  // Dado sensível não está na página até revelar
  await expect(page.getByText('MAT-005-FICT')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/shots/${info.project.name}-dossie.png`, fullPage: true });
  await page.getByRole('button', { name: 'Revelar dados restritos' }).click();
  await expect(page.getByText('MAT-005-FICT')).toBeVisible();
});

test('usuário sem permissão não vê oportunidades', async ({ page }) => {
  await login(page, COMUM);
  await expect(page.getByText('Sua conta ainda não tem acesso')).toBeVisible();
});

test('PDF do dossiê não contém dado sensível mesmo depois de revelado', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PDF só no Chromium desktop');
  await login(page, ADMIN);
  await page.getByRole('link', { name: /MD-001/ }).click();
  await page.getByRole('button', { name: 'Revelar dados restritos' }).click();
  await expect(page.getByText('MAT-001-FICT')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('MAT-001-FICT')).toBeHidden();
  // controles +/− do mapa não vão para o papel
  await expect(page.locator('.maplibregl-ctrl-top-right')).toBeHidden();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/shots/dossie-impressao.png', fullPage: true });
  await page.pdf({ path: 'test-results/shots/dossie-MD-001.pdf', format: 'A4', printBackground: true });
});
