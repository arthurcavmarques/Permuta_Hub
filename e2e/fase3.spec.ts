import { expect, test, type Page } from '@playwright/test';

// Fase 3: o comprador registra a tese, o sistema sugere a área com motivos, a curadoria aprova e ajusta a nota;
// alterar a tese recalcula. Mais: o dossiê mostra o estudo (unidades, valor por unidade, dinheiro × permuta).
const ADMIN = { email: 'admin@permutahub.local', password: 'admin-local-123' };
const BUYER = { email: 'comprador@permutahub.local', password: 'comprador-local-123' };

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/oportunidades/);
}

test('comprador vê o estudo no dossiê e acessa "O que procuro"', async ({ page }) => {
  await login(page, BUYER);
  await page.goto('/oportunidades');
  await page.getByRole('link', { name: /MD-001/ }).first().click();
  const split = page.getByTestId('payment-split');
  await expect(page.getByText('valor da área por unidade')).toBeVisible();
  await expect(split).toContainText('40% em dinheiro');
  await expect(split).toContainText('60% em permuta/adesão');
  await page.getByRole('link', { name: 'O que procuro' }).click();
  await expect(page.getByRole('heading', { name: 'O que sua empresa procura' })).toBeVisible();
});

test('tese do comprador vira match explicado, curadoria aprova e mudança na tese recalcula', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'fluxo longo com duas contas: só no desktop');
  const name = `Tese E2E ${Date.now()}`;

  // 1. Comprador cadastra a tese: Porto Alegre, terreno, 1.000–2.000 m², venda (casa com MD-003, 1.250 m²).
  const buyer = await browser.newPage();
  await login(buyer, BUYER);
  await buyer.goto('/teses');
  await buyer.getByRole('button', { name: 'Nova tese' }).click();
  const form = buyer.getByRole('form', { name: 'Salvar tese' });
  await form.getByLabel('Nome da tese').fill(name);
  await form.getByLabel('Terreno urbano').check();
  await form.getByLabel('Cidades').fill('porto alegre');
  await form.getByLabel('Área mínima (m²)').fill('1.000');
  await form.getByLabel('Área máxima (m²)').fill('2000');
  await form.getByLabel('Venda').check();
  await form.getByRole('button', { name: 'Salvar tese' }).click();
  await expect(buyer.getByTestId('thesis').filter({ hasText: name })).toContainText('Ativa');
  // O comprador não vê matches (só recebe o que for enviado).
  await buyer.goto('/admin/matches');
  await expect(buyer.getByTestId('match')).toHaveCount(0);
  await buyer.close();

  // 2. Curadoria vê a sugestão com os motivos e aprova com nota ajustada.
  const admin = await browser.newPage();
  await login(admin, ADMIN);
  await admin.goto('/admin/matches');
  const card = admin.getByTestId('match').filter({ hasText: name }).filter({ hasText: 'MD-003' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Compatível: metragem 1.250 m² dentro de 1.000–2.000 m²');
  await expect(card).toContainText('Compatível: formato venda');
  await card.getByLabel('Ajustar nota').fill('99');
  await card.getByLabel('Observação da curadoria').fill('Prioridade da semana');
  await card.getByRole('button', { name: 'Aprovar' }).click();
  await expect(card).toHaveCount(0); // saiu da lista de sugeridos

  await admin.getByLabel('Situação').selectOption('approved');
  const approved = admin.getByTestId('match').filter({ hasText: name });
  await expect(approved).toContainText('Aprovado');
  await expect(approved.getByTestId('match-score')).toHaveText('99');

  // 3. Curadoria muda a tese em nome da empresa: MD-003 deixa de combinar, mas a decisão fica registrada.
  await admin.goto('/admin/teses');
  const beta = await admin
    .locator('#thesis-org option', { hasText: 'Incorporadora Exemplo Beta' })
    .getAttribute('value');
  await admin.getByLabel('Empresa').selectOption(beta!);
  const thesis = admin.getByTestId('thesis').filter({ hasText: name });
  await thesis.getByRole('button', { name: 'Editar' }).click();
  const edit = admin.getByRole('form', { name: 'Salvar tese' });
  await edit.getByLabel('Área máxima (m²)').fill('1100');
  await edit.getByRole('button', { name: 'Salvar tese' }).click();
  await expect(admin.getByTestId('thesis').filter({ hasText: name })).toContainText('1.000 m² a 1.100 m²');

  await admin.goto('/admin/matches');
  await admin.getByLabel('Situação').selectOption('approved');
  await expect(admin.getByTestId('match').filter({ hasText: name })).toContainText(
    'Não combina mais',
  );
  await admin.close();
});
