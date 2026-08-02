import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER = 'AMBIENTE FICTÍCIO · NÃO USAR EM PRODUÇÃO';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada`);
  return value;
}

function projectCode() {
  return (process.env.HOMOLOGATION_PROJECT_CODE || 'HOM-001').trim().toUpperCase();
}

function recordPrefix() {
  return (process.env.HOMOLOGATION_RECORD_PREFIX || '[HOMOLOGAÇÃO]').trim();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function visibleError(page) {
  const locator = page.locator('.auth-message.error').first();
  if ((await locator.count()) === 0 || !(await locator.isVisible().catch(() => false))) return '';
  return String(await locator.textContent() || '').trim();
}

async function login(page, baseUrl) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.getByLabel('E-mail').fill(required('ELOS_TEST_EMAIL'));
  await page.getByLabel('Senha').fill(required('ELOS_TEST_PASSWORD'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    const current = new URL(page.url());
    if (!current.pathname.startsWith('/login')) return;
    const message = await visibleError(page);
    if (message) throw new Error(`Login recusado: ${message}`);
  }
  throw new Error(`Login não concluído. URL: ${page.url()}`);
}

async function selectedProjectText(page) {
  const select = page.locator('#elos-project-select');
  if ((await select.count()) === 0) return '';
  return String(await select.locator('option:checked').textContent() || '').trim();
}

async function selectSafeProject(page, baseUrl) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle', timeout: 30_000 });
  const select = page.locator('#elos-project-select');
  if ((await select.count()) === 0) throw new Error('Seletor de empreendimento não encontrado.');

  const code = projectCode();
  let value = '';
  let label = '';
  const count = await select.locator('option').count();
  for (let index = 0; index < count; index += 1) {
    const option = select.locator('option').nth(index);
    const optionLabel = String(await option.textContent() || '').trim();
    if (optionLabel.toUpperCase().includes(code)) {
      value = String(await option.getAttribute('value') || '');
      label = optionLabel;
      break;
    }
  }
  if (!value) throw new Error(`Obra segura ${code} não encontrada.`);
  if ((await select.inputValue()) !== value) {
    await select.selectOption(value);
    await page.waitForTimeout(800);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }
  const active = await selectedProjectText(page);
  if (!active.toUpperCase().includes(code)) throw new Error(`Obra segura não ativada. Ativa: ${active}`);
  return label;
}

async function assertSafeContext(page) {
  const body = String(await page.locator('body').innerText() || '').toUpperCase();
  const company = (process.env.HOMOLOGATION_COMPANY_MARKER || 'BOSSA EMPREENDIMENTOS').trim().toUpperCase();
  const activeProject = (await selectedProjectText(page)).toUpperCase();
  const code = projectCode();
  const prefix = recordPrefix().toUpperCase();

  if (!body.includes(company)) throw new Error(`Empresa autorizada não confirmada: ${company}`);
  if (!activeProject.includes(code) || !activeProject.includes(prefix)) {
    throw new Error(`Execução bloqueada fora da obra fictícia. Ativa: ${activeProject || 'não identificada'}`);
  }
}

async function gotoSafe(page, baseUrl, route) {
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 30_000 });
  if (!response || response.status() >= 400) throw new Error(`${route}: HTTP ${response?.status() ?? 'sem resposta'}`);
  if (page.url().includes('/login')) throw new Error(`${route}: sessão redirecionada para login`);
  await assertSafeContext(page);
}

async function submit(page, buttonName) {
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  const message = await visibleError(page);
  if (message) throw new Error(message);
}

async function pageContains(page, text) {
  return String(await page.locator('body').innerText() || '').includes(text);
}

async function ensureLocations(page, baseUrl) {
  await gotoSafe(page, baseUrl, '/empreendimentos/locais');
  if (await pageContains(page, 'HOM-ROO')) return 'Estrutura já existente';

  const rows = [
    'Ordem;Código;Nome;Tipo;Repetições;Código superior;Observações',
    `10;HOM-TER;${recordPrefix()} Térreo;pavimento;1;;${MARKER}`,
    `20;HOM-G1;${recordPrefix()} Garagem 1;pavimento;1;;${MARKER}`,
    `30;HOM-G2;${recordPrefix()} Garagem 2;pavimento;1;;${MARKER}`,
    `40;HOM-LAZ;${recordPrefix()} Lazer;pavimento;1;;${MARKER}`,
    ...Array.from({ length: 8 }, (_, index) => {
      const floor = index + 1;
      return `${50 + index * 10};HOM-P${floor};${recordPrefix()} Pavimento ${floor};pavimento;1;;${MARKER}`;
    }),
    `130;HOM-COB;${recordPrefix()} Cobertura;pavimento;1;;${MARKER}`,
    `140;HOM-ROO;${recordPrefix()} Rooftop;pavimento;1;;${MARKER}`,
  ].join('\n');

  await page.getByRole('button', { name: /Importar estrutura/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.locator('textarea[name="structure_text"]').fill(rows);
  await submit(page, 'Importar estrutura');
  if (!(await pageContains(page, 'HOM-ROO'))) throw new Error('Estrutura importada, mas não encontrada após o retorno.');
  return '14 locais criados';
}

function unitRows() {
  const header = 'Código;Torre;Pavimento;Tipo;Posição;Código local;Área privativa;Privativa descoberta;Área comum;Área total;Fração ideal;Dormitórios;Suítes;Vagas;Descrição vagas;Preço tabela;Status;Matrícula;Observações';
  const rows = [header];
  for (let floor = 1; floor <= 8; floor += 1) {
    rows.push(`HOM-${floor}01;Aurora;${floor};${recordPrefix()} Tipo A;Frente;HOM-P${floor};73,20;0;26,80;100,00;0,0125;2;1;1;Vaga HOM-${floor}01;950000;Disponível;;${MARKER}`);
    rows.push(`HOM-${floor}02;Aurora;${floor};${recordPrefix()} Tipo B;Fundos;HOM-P${floor};62,40;0;23,60;86,00;0,0108;2;1;1;Vaga HOM-${floor}02;890000;Disponível;;${MARKER}`);
  }
  rows.push(`HOM-901;Aurora;9;${recordPrefix()} Cobertura A;Frente;HOM-COB;122,00;35,00;43,00;200,00;0,0250;3;3;2;Vagas HOM-901 A/B;1750000;Disponível;;${MARKER}`);
  rows.push(`HOM-902;Aurora;9;${recordPrefix()} Cobertura B;Fundos;HOM-COB;118,00;32,00;40,00;190,00;0,0240;3;3;2;Vagas HOM-902 A/B;1680000;Disponível;;${MARKER}`);
  return rows.join('\n');
}

async function ensureUnits(page, baseUrl) {
  await gotoSafe(page, baseUrl, '/empreendimentos/unidades');
  if (await pageContains(page, 'HOM-902')) return '18 unidades já existentes';
  await page.getByRole('button', { name: /Importar unidades/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.locator('textarea[name="units_text"]').fill(unitRows());
  await submit(page, 'Importar unidades');
  if (!(await pageContains(page, 'HOM-902'))) throw new Error('Unidades importadas, mas não encontradas após o retorno.');
  return '18 unidades criadas';
}

async function ensureSupplier(page, baseUrl, supplier) {
  const query = encodeURIComponent(supplier.legal_name);
  await gotoSafe(page, baseUrl, `/cadastros/fornecedores?q=${query}`);
  if (await pageContains(page, supplier.legal_name)) return 'existente';

  await gotoSafe(page, baseUrl, '/cadastros/fornecedores');
  await page.locator('details.registry-create summary').click();
  const form = page.locator('details.registry-create[open] form');
  await form.locator('[name="legal_name"]').fill(supplier.legal_name);
  await form.locator('[name="trade_name"]').fill(supplier.trade_name);
  await form.locator('[name="tax_id"]').fill(supplier.tax_id);
  await form.locator('[name="category"]').fill(supplier.category);
  await form.locator('[name="contact_name"]').fill('Agente Elos OS');
  await form.locator('[name="phone"]').fill('(47) 99999-0001');
  await form.locator('[name="email"]').fill(supplier.email);
  await form.locator('[name="city"]').fill('Itapema');
  await form.locator('[name="state"]').fill('SC');
  await form.locator('[name="notes"]').fill(MARKER);
  await submit(page, 'Salvar fornecedor');
  return 'criado';
}

async function ensureSuppliers(page, baseUrl) {
  const suppliers = [
    { legal_name: '[HOMOLOGAÇÃO] Concretos Aurora Ltda.', trade_name: 'Concretos Aurora Teste', tax_id: '99.000.000/0001-01', category: 'Concreto e argamassa', email: 'concreto.homologacao@example.com' },
    { legal_name: '[HOMOLOGAÇÃO] Elétrica Horizonte Ltda.', trade_name: 'Elétrica Horizonte Teste', tax_id: '99.000.000/0001-02', category: 'Instalações elétricas', email: 'eletrica.homologacao@example.com' },
    { legal_name: '[HOMOLOGAÇÃO] Materiais Atlântico Ltda.', trade_name: 'Materiais Atlântico Teste', tax_id: '99.000.000/0001-03', category: 'Materiais de construção', email: 'materiais.homologacao@example.com' },
  ];
  const statuses = [];
  for (const supplier of suppliers) statuses.push(await ensureSupplier(page, baseUrl, supplier));
  return `${statuses.filter((item) => item === 'criado').length} criado(s), ${statuses.filter((item) => item === 'existente').length} existente(s)`;
}

async function ensureClient(page, baseUrl, client) {
  const query = encodeURIComponent(client.name);
  await gotoSafe(page, baseUrl, `/cadastros/clientes?q=${query}`);
  if (await pageContains(page, client.name)) return 'existente';

  await gotoSafe(page, baseUrl, '/cadastros/clientes');
  await page.locator('details.registry-create summary').click();
  const form = page.locator('details.registry-create[open] form');
  await form.locator('[name="person_type"]').selectOption(client.person_type);
  await form.locator('[name="name"]').fill(client.name);
  await form.locator('[name="tax_id"]').fill(client.tax_id);
  await form.locator('[name="profession"]').fill(client.profession);
  await form.locator('[name="email"]').fill(client.email);
  await form.locator('[name="phone"]').fill('(47) 99999-1001');
  await form.locator('[name="city"]').fill('Itapema');
  await form.locator('[name="state"]').fill('SC');
  await form.locator('[name="nationality"]').fill('Brasileira');
  await form.locator('[name="notes"]').fill(MARKER);
  await submit(page, 'Salvar cliente');
  return 'criado';
}

async function ensureClients(page, baseUrl) {
  const clients = [
    { name: '[HOMOLOGAÇÃO] Ana Cliente Aurora', person_type: 'PF', tax_id: '999.000.000-01', profession: 'Arquiteta', email: 'ana.aurora.homologacao@example.com' },
    { name: '[HOMOLOGAÇÃO] Bruno Cliente Aurora', person_type: 'PF', tax_id: '999.000.000-02', profession: 'Empresário', email: 'bruno.aurora.homologacao@example.com' },
  ];
  const statuses = [];
  for (const client of clients) statuses.push(await ensureClient(page, baseUrl, client));
  return `${statuses.filter((item) => item === 'criado').length} criado(s), ${statuses.filter((item) => item === 'existente').length} existente(s)`;
}

async function ensureBroker(page, baseUrl) {
  const name = '[HOMOLOGAÇÃO] Corretor Aurora';
  await gotoSafe(page, baseUrl, `/comercial/corretores?q=${encodeURIComponent(name)}`);
  if (await pageContains(page, name)) return 'Corretor já existente';

  await gotoSafe(page, baseUrl, '/comercial/corretores');
  await page.locator('details.registry-create summary').click();
  const form = page.locator('details.registry-create[open] form').first();
  await form.locator('[name="kind"]').selectOption('broker');
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="legal_name"]').fill('[HOMOLOGAÇÃO] Carlos Corretor de Teste');
  await form.locator('[name="tax_id"]').fill('999.000.000-03');
  await form.locator('[name="creci_number"]').fill('HOM-12345');
  await form.locator('[name="creci_state"]').fill('SC');
  await form.locator('[name="phone"]').fill('(47) 99999-2001');
  await form.locator('[name="email"]').fill('corretor.aurora.homologacao@example.com');
  await form.locator('[name="default_commission_pct"]').fill('5,00');
  await form.locator('[name="payment_due_days"]').fill('30');
  await form.locator('[name="pix_key"]').fill('corretor.aurora.homologacao@example.com');
  await form.locator('[name="notes"]').fill(MARKER);
  await submit(page, 'Salvar cadastro');
  return 'Corretor criado';
}

async function runStep(page, outputDir, name, fn) {
  const started = Date.now();
  const result = { name, status: 'passed', durationMs: 0, details: '', error: null, screenshot: null };
  try {
    result.details = await fn();
    const file = path.join(outputDir, `${name.replace(/[^a-z0-9]+/gi, '_')}.png`);
    await page.screenshot({ path: file, fullPage: true });
    result.screenshot = file;
  } catch (error) {
    result.status = 'failed';
    result.error = errorMessage(error);
    const file = path.join(outputDir, `FAIL_${name.replace(/[^a-z0-9]+/gi, '_')}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    result.screenshot = file;
  }
  result.durationMs = Date.now() - started;
  return result;
}

export async function runPhase0() {
  const baseUrl = required('ELOS_BASE_URL').replace(/\/$/, '');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join('/tmp', 'elos-homologation', runId);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const results = [];
  let project = '';

  try {
    await login(page, baseUrl);
    project = await selectSafeProject(page, baseUrl);
    await assertSafeContext(page);
    results.push(await runStep(page, outputDir, '01_locais', () => ensureLocations(page, baseUrl)));
    results.push(await runStep(page, outputDir, '02_unidades', () => ensureUnits(page, baseUrl)));
    results.push(await runStep(page, outputDir, '03_fornecedores', () => ensureSuppliers(page, baseUrl)));
    results.push(await runStep(page, outputDir, '04_clientes', () => ensureClients(page, baseUrl)));
    results.push(await runStep(page, outputDir, '05_corretor', () => ensureBroker(page, baseUrl)));
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    runId,
    phase: 'phase0',
    project,
    marker: MARKER,
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
  };
  await fs.writeFile(path.join(outputDir, 'phase0-report.json'), JSON.stringify(report, null, 2));
  return report;
}
