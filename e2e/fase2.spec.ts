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
  test
    .info()
    .annotations.push({ type: 'termo', description: needsTerm ? 'aceito agora' : 'já aceito' });
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

async function fillLeadSteps(page: Page, contact?: { name: string; phone: string; email: string }) {
  await page.getByLabel('Sou o(a) proprietário(a)').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Cidade').fill('Porto Alegre');
  await page.getByLabel('Bairro').fill('Ipanema');
  await page.getByLabel('Onde fica a área?').fill('Perto da orla, esquina conhecida (fictício)');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Tamanho aproximado (m²)').fill('8000');
  await page.getByLabel('Permuta').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  if (contact) {
    await page.getByLabel('Nome completo').fill(contact.name);
    await page.getByLabel('Celular (com DDD)').fill(contact.phone);
    await page.getByLabel('E-mail').fill(contact.email);
  }
  await page.getByLabel('Política de privacidade e termos de uso').check();
  await page.getByRole('button', { name: 'Enviar área' }).click();
  await expect(page.getByText('Recebemos sua área')).toBeVisible();
}

test('visitante oferece uma área pelo formulário público, sem login', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByRole('link', { name: 'Cadastre aqui' }).click();
  await expect(page).toHaveURL(/\/cadastrar-area/);
  // Validação por etapa: não avança sem escolher a localização.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Informe a cidade.')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await fillLeadSteps(page, {
    name: 'Visitante E2E',
    phone: '(51) 98888-0000',
    email: `visitante-${Date.now()}@teste.invalid`,
  });
});

test('proprietário cria conta, aceita o termo, cadastra área e acompanha', async ({
  page,
}, info) => {
  const email = `dono-${info.project.name}-${Date.now()}@teste.invalid`;
  await page.goto('/cadastro?tipo=owner');
  await expect(page.getByLabel('Proprietário(a) de área')).toBeChecked();
  await page.getByLabel('Nome completo').fill('Dona E2E');
  await page.getByLabel('Celular (com DDD)').fill('(51) 97777-0000');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha (mín. 10 caracteres)').fill('senha-e2e-12345');
  await page.getByLabel('Repita a senha').fill('senha-e2e-12345');
  await page.getByLabel('Política de privacidade e termos de uso').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();

  // Conta em análise, mas o proprietário já usa a própria área.
  await expect(page).toHaveURL(/\/minhas-areas/);
  await expect(page.getByText('Você ainda não cadastrou nenhuma área.')).toBeVisible();
  await page.goto('/oportunidades');
  await expect(page).toHaveURL(/\/minhas-areas/); // não navega catálogo
  await page.getByRole('link', { name: 'Cadastrar área' }).first().click();

  const term = page.getByTestId('agreement-owner_terms');
  await expect(term).toContainText('Dona E2E');
  await term.getByLabel('Li o texto acima e aceito o termo.').check();
  await term.getByRole('button', { name: 'Aceitar termo' }).click();

  await fillLeadSteps(page); // nome/contato vêm da conta
  await page.getByRole('link', { name: 'Ver minhas áreas' }).click();
  const area = page.getByTestId('owner-area');
  await expect(area).toHaveCount(1);
  await expect(area).toContainText('Ipanema, Porto Alegre');
  await expect(area).toContainText('Recebida');
});
