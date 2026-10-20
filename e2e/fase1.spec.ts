import { expect, test, type Page } from '@playwright/test';

// Fluxos da Fase 1 contra o banco local com seed (01, 02 e 03). Cada execução cria usuários novos.
const ADMIN = { email: 'admin@permutahub.local', password: 'admin-local-123' };
const COMPRADOR = { email: 'comprador@permutahub.local', password: 'comprador-local-123' };
const CORRETOR_PENDENTE = {
  email: 'corretor.pendente@permutahub.local',
  password: 'corretor-local-123',
};
const SENHA = 'senha-e2e-12345';

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/entrar/);
}

const unique = (prefix: string, project: string) =>
  `${prefix}-${project}-${Date.now()}@teste.invalid`;

test('corretor se cadastra, fica pendente, é aprovado pela curadoria e cadastra área', async ({
  page,
}, info) => {
  const email = unique('corretor', info.project.name);

  // 1. Cadastro: nasce pendente, com consentimento registrado.
  await page.goto('/entrar');
  await page.getByRole('link', { name: 'Criar conta' }).click();
  await page.getByLabel('Corretor(a) / intermediador(a)').check();
  await page.getByLabel('Nome completo').fill('Corretor E2E');
  await page.getByLabel('Celular (com DDD)').fill('(51) 99999-1234');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha (mín. 10 caracteres)').fill(SENHA);
  await page.getByLabel('Repita a senha').fill(SENHA);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('É preciso aceitar a política de privacidade.')).toBeVisible();
  await page.getByLabel(/Política de privacidade e termos de uso/).check();
  await page.getByLabel(/Receber oportunidades por WhatsApp/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page).toHaveURL(/\/conta/);
  await expect(page.getByText('Conta em análise')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cadastrar área' })).toHaveCount(0);
  await page.goto('/areas/nova');
  await expect(page).toHaveURL(/\/conta/); // pendente não passa do guard

  // Consentimento de WhatsApp aparece como autorizado, com versão.
  const whatsapp = page.locator('li', { hasText: 'Aceito receber oportunidades por WhatsApp' });
  await expect(whatsapp.getByText('Autorizado')).toBeVisible();

  // 2. CRECI com documento.
  await page.getByLabel('Número do CRECI').fill('12345-F');
  await page.getByLabel('Documento (PDF ou foto, até 10 MB)').setInputFiles({
    name: 'creci.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% documento ficticio de teste\n'),
  });
  await page.getByRole('button', { name: 'Enviar para verificação' }).click();
  await expect(page.getByText('Aguardando verificação')).toBeVisible();
  await logout(page);

  // 3. Curadoria aprova conta e CRECI; e-mails vão para a caixa de saída.
  await login(page, ADMIN);
  await page.getByRole('link', { name: 'Curadoria' }).click();
  await page.getByRole('link', { name: 'Usuários' }).click();
  const row = page.getByTestId(`user-${email}`);
  await expect(row.getByText('Conta em análise')).toBeVisible();
  await row.getByRole('button', { name: 'Aprovar' }).click();
  await expect(row.getByText('Conta aprovada')).toBeVisible();

  await page.getByRole('link', { name: 'Fila de CRECI' }).click();
  const creci = page.getByTestId(`creci-${email}`);
  await expect(creci.getByText('12345-F')).toBeVisible();
  // Verificação assistida (Fase 2.5): link da consulta oficial e nome conferido.
  await expect(creci.getByRole('link', { name: 'Consulta oficial CRECI-RS' })).toBeVisible();
  await creci.getByLabel('Nome como consta na consulta oficial').fill('CORRETOR E2E');
  await expect(creci.getByText('Nome confere com o cadastro.')).toBeVisible();
  await creci.getByRole('button', { name: 'Aprovar CRECI' }).click();
  await expect(creci).toHaveCount(0); // sai da fila

  await page.getByRole('link', { name: 'Caixa de saída' }).click();
  await expect(page.getByText(email).first()).toBeVisible();
  await logout(page);

  // 4. Corretor aprovado aceita o termo-mestre (Fase 2) e cadastra área: entra como captada,
  // segue para o editor e ele vê o dossiê cego dela.
  await login(page, { email, password: SENHA });
  await page.getByRole('link', { name: 'Cadastrar área' }).click();
  const master = page.getByTestId('agreement-broker_partnership');
  await master.getByLabel('Li o texto acima e aceito o termo.').check();
  await master.getByRole('button', { name: 'Aceitar termo' }).click();
  await page.getByLabel('Cidade').fill('Porto Alegre');
  await page.getByLabel('Bairro').fill('Bairro E2E');
  await page.getByLabel('Área (m²)').fill('2450');
  await page.getByLabel('Permuta').check();
  await page.getByRole('button', { name: 'Cadastrar área' }).click();
  await expect(page).toHaveURL(/\/editar$/);
  await page.getByRole('link', { name: 'Ver versão cega' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2.500 m²');
  await expect(page.getByText('Captada').first()).toBeVisible();
});

test('corretor com CRECI pendente não tem acesso ao cadastro de área', async ({ page }) => {
  await login(page, CORRETOR_PENDENTE);
  await expect(page.getByRole('link', { name: 'Oportunidades' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cadastrar área' })).toHaveCount(0);
  await page.goto('/areas/nova');
  await expect(page.getByText(/CRECI verificado pela curadoria/)).toBeVisible();
});

test('comprador vê só o que a organização recebeu e convida colega, que entra já aprovado', async ({
  page,
  browser,
}, info) => {
  await login(page, COMPRADOR);
  await expect(page.getByText('3 áreas')).toBeVisible();
  await expect(page.getByRole('link', { name: /MD-001/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /MD-002/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Curadoria' })).toHaveCount(0);

  // Convite pela página da organização.
  const convidado = unique('convidado', info.project.name);
  await page.getByRole('link', { name: 'Minha conta' }).click();
  await page.getByRole('link', { name: 'Gerenciar' }).click();
  await expect(page.getByRole('heading', { name: /Incorporadora Exemplo Beta/ })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(convidado);
  await page.getByRole('button', { name: 'Gerar convite' }).click();
  const link = await page.getByLabel('Link do convite').inputValue();
  expect(link).toMatch(/\/convite\/[0-9a-f]{48}$/);
  await expect(page.getByText(convidado)).toBeVisible(); // convite em aberto

  // Convidado abre o link em outro navegador, cria a conta e cai direto nas oportunidades.
  const ctx = await browser.newContext({ ...info.project.use });
  const guest = await ctx.newPage();
  await guest.goto(link);
  await expect(guest.getByText(/Incorporadora Exemplo Beta/)).toBeVisible();
  await guest.getByRole('link', { name: 'Criar conta e aceitar' }).click();
  await expect(guest.getByLabel('E-mail', { exact: true })).toHaveValue(convidado);
  await guest.getByLabel('Nome completo').fill('Convidado E2E');
  await guest.getByLabel('Celular (com DDD)').fill('51988887777');
  await guest.getByLabel('Senha (mín. 10 caracteres)').fill(SENHA);
  await guest.getByLabel('Repita a senha').fill(SENHA);
  await guest.getByLabel(/Política de privacidade e termos de uso/).check();
  await guest.getByRole('button', { name: 'Criar conta' }).click();
  await expect(guest).toHaveURL(/\/oportunidades/);
  await expect(guest.getByText('3 áreas')).toBeVisible();

  // Link já usado não serve de novo.
  await guest.goto(link);
  await expect(guest.getByText(/inválido, expirou ou já foi usado/)).toBeVisible();
  await ctx.close();
});
