import { expect, test, type Page } from '@playwright/test';

// Fase 2B: importação pela tela (prévia obrigatória, reimportar não duplica, desfazer) e painel de publicáveis.
const ADMIN = { email: 'admin@permutahub.local', password: 'admin-local-123' };

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/oportunidades/);
}

test('curadoria importa o Land Bank com prévia, reimporta sem duplicar, vê o que falta e desfaz', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'fluxo longo da curadoria: só no desktop');
  const ts = Date.now();
  const md1 = `E2E-${ts}-1`;
  const md2 = `E2E-${ts}-2`;
  const fileName = `landbank-e2e-${ts}.csv`;
  const csv = [
    'LAND BANK (FICTÍCIO E2E);;;;;;;',
    'Nº MD;Área (m²);Tipo de Terreno;Bairro;Status da Negociação;Empresas;Proprietário;Coluna Estranha',
    `${md1};12.400,50;Urbano;Bairro E2E ${ts};Disponível;Construtora E2E ${ts};Dono E2E ${ts};x`,
    `${md2};1,5 ha;Gleba;Bairro E2E ${ts};status esquisito ${ts};;;`,
  ].join('\n');
  const file = { name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') };

  await login(page, ADMIN);
  await page.goto('/admin/importacao');
  await page.getByLabel('Arquivo (.csv ou .xlsx)').setInputFiles(file);

  // Mapeamento: coluna desconhecida e status sem equivalente aparecem para a curadoria escolher.
  await expect(page.getByTestId('import-columns')).toContainText('Coluna Estranha');
  await page.getByLabel(`status esquisito ${ts}`).selectOption({ label: 'Qualificando' });
  await expect(page.getByText('Mapeamento alterado (ainda não salvo).')).toBeVisible();

  // Prévia obrigatória: "Importar" só depois dela.
  await expect(page.getByRole('button', { name: 'Importar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  const result = page.getByTestId('import-result');
  await expect(result).toContainText('Prévia (nada foi gravado)');
  await expect(page.getByTestId('count-inserted')).toContainText('2');
  await expect(result).toContainText('rebaixado para "em qualificação"');
  // Dado do proprietário não aparece na prévia.
  await expect(result).not.toContainText(`Dono E2E ${ts}`);

  await page.getByRole('button', { name: 'Importar' }).click();
  await expect(result).toContainText('Importado');
  const batch = page.getByTestId('import-batches').locator('li').filter({ hasText: fileName });
  await expect(batch).toHaveCount(1);
  await expect(batch.first()).toContainText('Íntegro');

  // Reimportar o mesmo arquivo: nada novo, e o aviso de arquivo já importado.
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(result).toContainText('já foi importado');
  await expect(page.getByTestId('count-inserted')).toContainText('0');
  await expect(page.getByTestId('count-unchanged')).toContainText('2');

  // Painel de publicáveis: o que falta por área.
  await page.getByRole('link', { name: 'Publicáveis' }).click();
  await page.getByLabel('Buscar MD ou bairro').fill(`E2E-${ts}`);
  const row = page.getByTestId(`publishable-${md1}`);
  await expect(row).toContainText('Mandato desconhecido');
  await expect(row).toContainText('Zoneamento');
  await expect(page.getByTestId(`publishable-${md2}`)).toContainText('Localização no mapa');

  // Desfazer o lote: as áreas criadas saem do painel (arquivadas).
  await page.getByRole('link', { name: 'Importação' }).click();
  // O lote de desfazer entra no topo com o mesmo arquivo: fixa a linha do lote importado pelo id.
  const batchId = await page
    .getByTestId('import-batches')
    .locator('li')
    .filter({ hasText: fileName })
    .first()
    .getAttribute('data-testid');
  const ours = page.getByTestId(batchId!);
  await ours.getByRole('button', { name: 'Desfazer' }).click();
  await ours.getByLabel('Motivo (opcional)').fill('teste E2E');
  await ours.getByRole('button', { name: 'Desfazer' }).click();
  await expect(ours).toContainText('Desfeito');
  await page.getByRole('link', { name: 'Publicáveis' }).click();
  await page.getByLabel('Buscar MD ou bairro').fill(`E2E-${ts}`);
  await expect(page.getByText('Nenhuma área com esses filtros.')).toBeVisible();
});
