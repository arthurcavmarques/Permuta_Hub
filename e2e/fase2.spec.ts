import { expect, test, type Page } from '@playwright/test';

// Fluxos da Fase 2 contra o banco local com seed (01, 02 e 03).
const COMPRADOR = { email: 'comprador@permutahub.local', password: 'comprador-local-123' };
const COLEGA = { email: 'colega@permutahub.local', password: 'colega-local-123' };
const ADMIN = { email: 'admin@permutahub.local', password: 'admin-local-123' };

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/oportunidades/);
}

test('comprador só vê o dado restrito depois de aceitar o termo da área (D020)', async ({
  page,
}, info) => {
  // Um usuário e uma área por projeto: o aceite é pessoal e por área.
  const [user, md, mat] =
    info.project.name === 'desktop'
      ? [COLEGA, 'MD-005', 'MAT-005-FICT']
      : [COMPRADOR, 'MD-003', 'MAT-003-FICT'];
  await login(page, user);
  await page.getByRole('link', { name: new RegExp(md) }).click();

  const panel = page.getByTestId('sensitive-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByText(mat)).toHaveCount(0);

  // O aceite persiste no banco local: numa segunda execução sem `db reset` o termo já existe.
  const needsTerm = await panel.getByText('aceite o termo').isVisible();
  test.info().annotations.push({ type: 'termo', description: needsTerm ? 'aceito agora' : 'já aceito' });
  await panel.getByRole('button', { name: 'Revelar dados restritos' }).click();
  if (needsTerm) {
    const card = page.getByTestId('agreement-non_circumvention');
    await expect(card).toContainText(md);
    await expect(card).toContainText('MINUTA');
    const accept = card.getByRole('button', { name: 'Aceitar termo' });
    await expect(accept).toBeDisabled();
    await card.getByLabel('Li o texto acima e aceito o termo.').check();
    await accept.click();
  }
  await expect(page.getByText(mat)).toBeVisible();
});

test('curadoria vê os termos versionados e pode abrir o texto', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/admin/termos');
  const buyer = page.getByTestId('terms-non_circumvention');
  await expect(buyer).toContainText('Termo de confidencialidade e não-circunvenção');
  await expect(buyer).toContainText('Ativa');
  await buyer.getByRole('button', { name: 'Ver texto' }).first().click();
  await expect(buyer).toContainText('SHA-256');
});
