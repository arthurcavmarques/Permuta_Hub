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

// PNG 1x1 válido (foto fictícia).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% documento ficticio de teste\n');

test('corretor monta o dossiê completo no editor e a versão cega reflete', async ({
  page,
}, info) => {
  await login(page, { email: 'corretor@permutahub.local', password: 'corretor-local-123' });
  await page.getByRole('link', { name: 'Cadastrar área' }).click();
  // Termo-mestre já aceito no seed: vai direto ao formulário.
  await page.getByLabel('Cidade').fill('Porto Alegre');
  await page.getByLabel('Bairro').fill(`Bairro Editor ${info.project.name}`);
  await page.getByLabel('Área (m²)').fill('3210');
  await page.getByRole('button', { name: 'Cadastrar área' }).click();
  await expect(page).toHaveURL(/\/editar$/);

  // Dados do dossiê
  await page.getByLabel('Zoneamento').fill('Mista E2E');
  await page.getByLabel('Coef. de aproveitamento').fill('2,4');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Salvo.').first()).toBeVisible();

  // Localização exata pelo KML do Google Earth
  await page.getByTestId('kml-input').setInputFiles('scripts/fixtures/exemplo.kml');
  await expect(page.getByRole('button', { name: 'Remover localização' })).toBeVisible();

  // Foto liberada para a versão cega
  await page.getByTestId('media-input').setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const media = page.getByTestId('editor-media');
  await expect(media).toHaveCount(1);
  await media.getByLabel('Pode ir para a versão cega').check();
  await expect(media.getByLabel('Pode ir para a versão cega')).toBeChecked();

  // Dado sensível
  await page.getByRole('button', { name: 'Abrir dados restritos' }).click();
  await page.getByLabel('Matrícula').fill('MAT-E2E-EDITOR');
  await page.getByRole('button', { name: 'Salvar dados restritos' }).click();
  await expect(page.getByText('Salvo.').last()).toBeVisible();

  // Autorização do proprietário + aceite da área
  await page.getByTestId('authorization-input').setInputFiles({
    name: 'autorizacao.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(page.getByText('Aguardando curadoria')).toBeVisible();
  const term = page.getByTestId('agreement-broker_area_authorization');
  await term.getByLabel('Li o texto acima e aceito o termo.').check();
  await term.getByRole('button', { name: 'Aceitar termo' }).click();
  await expect(page.getByText('Você já autorizou a divulgação desta área.')).toBeVisible();

  // Versão cega: dados novos, foto liberada, nada restrito exposto.
  await page.getByRole('link', { name: 'Ver versão cega' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('3.200 m²');
  await expect(page.getByText('Mista E2E').first()).toBeVisible();
  await expect(page.locator('figure img')).toHaveCount(1);
  await expect(page.getByText('MAT-E2E-EDITOR')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Editar área' })).toBeVisible();
});

test('lead vira dossiê publicável sem planilha; sem pendências resolvidas não publica', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'fluxo longo da curadoria: só no desktop');
  const place = `Bairro Lead ${Date.now()}`;

  // 1. Visitante oferece a área.
  await page.goto('/cadastrar-area');
  await page.getByLabel('Sou o(a) proprietário(a)').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Cidade').fill('Porto Alegre');
  await page.getByLabel('Bairro').fill(place);
  await page.getByLabel('Onde fica a área?').fill('Rua fictícia, perto da praça');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Tamanho aproximado (m²)').fill('7000');
  await page.getByLabel('Venda').check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nome completo').fill('Proprietária Lead');
  await page.getByLabel('Celular (com DDD)').fill('(51) 96666-1111');
  await page.getByLabel('Política de privacidade e termos de uso').check();
  await page.getByRole('button', { name: 'Enviar área' }).click();
  await expect(page.getByText('Recebemos sua área')).toBeVisible();

  // 2. Curadoria converte o lead e vê o que falta.
  await login(page, ADMIN);
  await page.getByRole('link', { name: 'Curadoria' }).click();
  const lead = page.getByTestId('lead').filter({ hasText: place });
  await lead.getByRole('button', { name: 'Converter em oportunidade' }).click();
  await expect(page).toHaveURL(/\/admin\/areas\//);
  const blockers = page.getByTestId('blockers');
  await expect(blockers).toContainText('Zoneamento');
  await expect(blockers).toContainText('Corretor responsável');
  await expect(blockers).toContainText('Autorização do proprietário');
  await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
  const areaUrl = page.url();

  // 3. Curadoria atribui o corretor e define o mandato (fica no histórico).
  await page.getByLabel('Nota para a próxima mudança (opcional)').fill('Corretor da região');
  await page.getByLabel('Responsável').selectOption({ label: 'Corretor Aprovado' });
  await expect(page.getByTestId('timeline')).toContainText('Corretor da região');
  await page.getByLabel('Mandato').selectOption({ label: 'Exclusividade' });
  await expect(page.getByTestId('timeline')).toContainText('Mandato: Exclusividade');

  // 4. Curadoria completa o dossiê no editor e confere a autorização.
  await page.getByRole('link', { name: 'Editar área' }).click();
  await page.getByLabel('Zoneamento').fill('Residencial E2E');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Salvo.').first()).toBeVisible();
  await page.getByTestId('kml-input').setInputFiles('scripts/fixtures/exemplo.kml');
  await expect(page.getByRole('button', { name: 'Remover localização' })).toBeVisible();
  await page
    .getByTestId('media-input')
    .setInputFiles({ name: 'f.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('editor-media').getByLabel('Pode ir para a versão cega').check();
  await page.getByTestId('authorization-input').setInputFiles({
    name: 'autorizacao.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await page.getByRole('button', { name: 'Conferir' }).click();
  await expect(page.getByText('Conferida')).toBeVisible();

  // 5. Ainda falta o aceite do corretor: não publica.
  await page.goto(areaUrl);
  await expect(page.getByTestId('blockers')).toHaveText(
    /Aceite do corretor para divulgar esta área/,
  );
  await expect(page.getByTestId('blockers').locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sair' }).click();

  // 6. Corretor responsável dá o aceite de 1 clique na área.
  await login(page, { email: 'corretor@permutahub.local', password: 'corretor-local-123' });
  await page.goto(areaUrl.replace('/admin/areas/', '/areas/') + '/editar');
  const term = page.getByTestId('agreement-broker_area_authorization');
  await term.getByLabel('Li o texto acima e aceito o termo.').check();
  await term.getByRole('button', { name: 'Aceitar termo' }).click();
  await expect(page.getByText('Você já autorizou a divulgação desta área.')).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();

  // 7. Curadoria publica; o log de acesso mostra as gravações.
  await login(page, ADMIN);
  await page.goto(areaUrl);
  await expect(page.getByText('Nada pendente: a área pode ser publicada.')).toBeVisible();
  await page.getByLabel('Nota da publicação (opcional)').fill('Pronta');
  await page.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Área publicada.')).toBeVisible();
  await expect(page.getByTestId('timeline')).toContainText('Publicada');
  await page.getByRole('link', { name: 'Logs de acesso' }).click();
  await expect(page.getByTestId('access-log')).toContainText('Alterou localização exata');
});
