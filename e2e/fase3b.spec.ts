import { expect, test, type Page } from '@playwright/test';

// Fase 3B (Modelo 1, D030): o corretor declara, cadastra e publica sozinho; o match com a tese compatível é
// aprovado automaticamente; a lista de exclusão fica só com ele e a curadoria.
const ADMIN = { email: 'admin@permutahub.local', password: 'admin-local-123' };
const BROKER = { email: 'corretor@permutahub.local', password: 'corretor-local-123' };

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/oportunidades/);
}

// PNG 1x1 válido (foto fictícia) e PDF mínimo (autorização fictícia).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% documento ficticio de teste\n');

test('corretor declara, cadastra e publica sozinho; match aprovado automaticamente', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'fluxo longo: só no desktop');
  const place = `Bairro 3B ${Date.now()}`;

  // 1. Cadastro (termo-mestre já aceito no seed; a trava sem termo está no pgTAP 12_model1).
  await login(page, BROKER);
  await page.getByRole('link', { name: 'Cadastrar área' }).click();
  await page.getByLabel('Cidade').fill('Porto Alegre');
  await page.getByLabel('Bairro').fill(place);
  await page.getByLabel('Área (m²)').fill('3000');
  await page.getByRole('button', { name: 'Cadastrar área' }).click();
  await expect(page).toHaveURL(/\/editar$/);
  const md = (await page
    .getByText(/Memorial Descritivo · /)
    .first()
    .textContent())!
    .split('· ')[1]
    .trim();

  // 2. Dossiê: tipo, vocação, formato, zoneamento.
  await page.getByLabel('Tipo de área').selectOption({ label: 'Área urbana' });
  await page.getByLabel('Vertical').check();
  await page.getByLabel('Zoneamento').fill('Mista 3B');
  await page.getByLabel('Venda').check();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Salvo.').first()).toBeVisible();
  await page.getByTestId('kml-input').setInputFiles('scripts/fixtures/exemplo.kml');
  await expect(page.getByRole('button', { name: 'Remover localização' })).toBeVisible();
  await page
    .getByTestId('media-input')
    .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('editor-media')).toHaveCount(1);

  // 3. Ainda não publica: o painel diz o que falta.
  const panel = page.getByTestId('publish-panel');
  await expect(panel).toContainText('Declaração de autorização assinada pelo corretor');
  await expect(panel).toContainText('Mandato exclusivo ou não exclusivo');
  await expect(panel.getByRole('button', { name: 'Publicar área' })).toBeDisabled();

  // 4. Mandato, autorização escrita, lista de exclusão e declaração.
  await page
    .getByLabel('Mandato que você tem do proprietário')
    .selectOption({ label: 'Exclusividade' });
  await expect(page.getByText('Mandato registrado.')).toBeVisible();
  await page.getByTestId('authorization-input').setInputFiles({
    name: 'autorizacao.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(page.getByText('Aguardando curadoria')).toBeVisible();
  const exclusions = page.getByTestId('exclusions');
  await exclusions.getByLabel('Nome da empresa').fill('Construtora Exemplo Alfa (fictícia)');
  await exclusions.getByRole('button', { name: 'Adicionar' }).click();
  await expect(exclusions).toContainText('cadastrada na plataforma');
  const term = page.getByTestId('agreement-broker_area_authorization');
  await expect(term).toContainText(md);
  await term.getByLabel('Li o texto acima e aceito o termo.').check();
  await term.getByRole('button', { name: 'Aceitar termo' }).click();
  await expect(page.getByText('Você já assinou a declaração desta área.')).toBeVisible();

  // 5. Publica sozinho.
  await expect(panel).toContainText('Tudo certo');
  await panel.getByRole('button', { name: 'Publicar área' }).click();
  await expect(
    page.getByText('Área publicada. Para mudar algo, fale com a curadoria.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();

  // 6. Curadoria vê o match já aprovado, sem ter feito nada.
  await login(page, ADMIN);
  await page.goto('/admin/matches');
  await page.getByLabel('Situação').selectOption('approved');
  const card = page.getByTestId('match').filter({ hasText: md });
  await expect(card.first()).toBeVisible();
  await expect(card.first()).toContainText('Aprovado');
  await expect(card.filter({ hasText: 'Construtora Exemplo Alfa' })).toHaveCount(0);
});
