import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROUTES = [
  '/dashboard',
  '/configuracoes/acessos',
  '/configuracoes/permissoes',
  '/configuracoes/dados-backup',
  '/empreendimentos',
  '/empreendimentos/empresas',
  '/empreendimentos/caracteristicas',
  '/empreendimentos/locais',
  '/empreendimentos/unidades',
  '/engenharia/orcamentos',
  '/engenharia/servicos',
  '/engenharia/insumos',
  '/engenharia/precos',
  '/engenharia/levantamento',
  '/engenharia/orcamento-analitico',
  '/engenharia/cronograma',
  '/engenharia/curvas',
  '/engenharia/plano-contratacoes',
  '/engenharia/planejamento-suprimentos',
  '/execucao/cronograma',
  '/execucao/solicitacoes-materiais',
  '/execucao/diario-obras',
  '/execucao/qualidade',
  '/execucao/contratos-servicos',
  '/execucao/medicoes-contratos',
  '/execucao/ordens-servico',
  '/suprimentos/orcamentos-materiais',
  '/suprimentos/pedidos-compras',
  '/suprimentos/recebimento-materiais',
  '/suprimentos/estoque',
  '/financeiro/contas-a-pagar',
  '/financeiro/contas-a-receber',
  '/financeiro/indices-de-correcao',
  '/financeiro/fluxo-de-caixa',
  '/financeiro/relatorios',
  '/financeiro/notas-manuais',
  '/financeiro/notas-eletronicas',
  '/financeiro/contas-bancarias',
  '/financeiro/impostos',
  '/comercial/propostas',
  '/comercial/corretores',
  '/comercial/vendas',
  '/comercial/planos-de-pagamento',
  '/pos-obra/assistencias',
  '/pos-obra/vistorias',
  '/pos-obra/garantias'
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não configurada`);
  return value;
}

function configuredProjectCode() {
  return (process.env.HOMOLOGATION_PROJECT_CODE || 'HOM-001').trim().toUpperCase();
}

function configuredRecordPrefix() {
  return (process.env.HOMOLOGATION_RECORD_PREFIX || '[HOMOLOGAÇÃO]').trim().toUpperCase();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function postIssueComment(body) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPOSITORY?.trim() || 'fabionicodemus-lang/elos-os';
  const issue = process.env.HOMOLOGATION_ISSUE?.trim() || '165';
  if (!token) return;

  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify({ body })
  });

  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
}

async function visibleLoginError(page) {
  const error = page.locator('.auth-message.error').first();
  if ((await error.count()) === 0 || !(await error.isVisible().catch(() => false))) return '';
  return String(await error.textContent() || '').trim();
}

async function login(page, baseUrl) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.getByLabel('E-mail').fill(required('ELOS_TEST_EMAIL'));
  await page.getByLabel('Senha').fill(required('ELOS_TEST_PASSWORD'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(400);
    const currentUrl = new URL(page.url());
    if (!currentUrl.pathname.startsWith('/login')) {
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      return;
    }

    const loginError = await visibleLoginError(page);
    if (loginError) {
      throw new Error(`Login recusado pelo Elos OS: ${loginError}`);
    }
  }

  const currentUrl = page.url();
  const body = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  throw new Error(
    `Login não concluiu em 30 segundos. URL atual: ${currentUrl}. Tela: ${body.slice(0, 350) || 'sem conteúdo'}`
  );
}

async function selectedProjectText(page) {
  const select = page.locator('#elos-project-select');
  if ((await select.count()) === 0) return '';
  return String(await select.locator('option:checked').textContent() || '').trim();
}

async function selectHomologationProject(page, baseUrl) {
  const projectCode = configuredProjectCode();
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle', timeout: 30_000 });

  const select = page.locator('#elos-project-select');
  if ((await select.count()) === 0) {
    const body = String(await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    throw new Error(`Seletor de empreendimento não encontrado após o login. Tela: ${body.slice(0, 350)}`);
  }

  let targetValue = '';
  let targetLabel = '';
  const optionCount = await select.locator('option').count();
  for (let index = 0; index < optionCount; index += 1) {
    const option = select.locator('option').nth(index);
    const label = String(await option.textContent() || '').trim();
    if (label.toUpperCase().includes(projectCode)) {
      targetValue = String(await option.getAttribute('value') || '');
      targetLabel = label;
      break;
    }
  }

  if (!targetValue) {
    const options = [];
    for (let index = 0; index < optionCount; index += 1) {
      options.push(String(await select.locator('option').nth(index).textContent() || '').trim());
    }
    throw new Error(
      `Empreendimento seguro ${projectCode} não localizado. Disponíveis: ${options.filter(Boolean).join(' | ') || 'nenhum'}`
    );
  }

  if ((await select.inputValue()) !== targetValue) {
    await select.selectOption(targetValue);
    await page.waitForTimeout(700);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }

  const activeLabel = await selectedProjectText(page);
  if (!activeLabel.toUpperCase().includes(projectCode)) {
    throw new Error(`Falha ao ativar o empreendimento seguro. Ativo: ${activeLabel || 'não identificado'}`);
  }

  return targetLabel;
}

async function assertHomologationContext(page) {
  const body = String(await page.locator('body').innerText() || '').toUpperCase();
  const projectCode = configuredProjectCode();
  const recordPrefix = configuredRecordPrefix();
  const companyMarker = (process.env.HOMOLOGATION_COMPANY_MARKER || 'BOSSA EMPREENDIMENTOS').trim().toUpperCase();
  const activeProject = (await selectedProjectText(page)).toUpperCase();

  if (companyMarker && !body.includes(companyMarker)) {
    throw new Error(`Empresa autorizada não confirmada. Marcador ausente: ${companyMarker}`);
  }

  if (activeProject) {
    if (!activeProject.includes(projectCode) || !activeProject.includes(recordPrefix)) {
      throw new Error(`Execução bloqueada fora da obra de homologação. Empreendimento ativo: ${activeProject}`);
    }
  } else if (!body.includes(projectCode) || !body.includes(recordPrefix)) {
    throw new Error(`Contexto seguro não confirmado na tela. Exigidos: ${projectCode} e ${recordPrefix}`);
  }

  return activeProject || `${projectCode} · ${recordPrefix}`;
}

export async function runHomologation({ phase = 'smoke' } = {}) {
  const baseUrl = required('ELOS_BASE_URL').replace(/\/$/, '');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join('/tmp', 'elos-homologation', runId);
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: outputDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  const results = [];
  let homologationProject = '';
  let startupError = '';

  try {
    await login(page, baseUrl);
    homologationProject = await selectHomologationProject(page, baseUrl);
    await assertHomologationContext(page);

    for (const route of ROUTES) {
      const started = Date.now();
      const result = { route, status: 'passed', durationMs: 0, title: '', error: null, screenshot: null };
      try {
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 30_000 });
        result.title = await page.title();
        if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status() ?? 'sem resposta'}`);
        if (page.url().includes('/login')) throw new Error('Sessão redirecionada para login');
        await assertHomologationContext(page);
        const body = await page.locator('body').innerText();
        if (/Application error|Internal Server Error|Unhandled Runtime Error/i.test(body)) {
          throw new Error('Erro de aplicação visível na página');
        }
        const filename = route.replaceAll('/', '_').replace(/^_/, '') || 'dashboard';
        const screenshot = path.join(outputDir, `${filename}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        result.screenshot = screenshot;
      } catch (error) {
        result.status = 'failed';
        result.error = errorMessage(error);
        const filename = `FAIL_${route.replaceAll('/', '_').replace(/^_/, '') || 'dashboard'}.png`;
        const screenshot = path.join(outputDir, filename);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        result.screenshot = screenshot;
      }
      result.durationMs = Date.now() - started;
      results.push(result);
    }
  } catch (error) {
    startupError = errorMessage(error);
    await page.screenshot({ path: path.join(outputDir, 'FAIL_STARTUP.png'), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    runId,
    phase,
    startedAt: runId,
    baseUrl,
    companyMarker: process.env.HOMOLOGATION_COMPANY_MARKER || 'Bossa Empreendimentos',
    project: homologationProject,
    projectCode: configuredProjectCode(),
    recordPrefix: configuredRecordPrefix(),
    startupError: startupError || null,
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length + (startupError ? 1 : 0),
    results
  };
  await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));

  const failures = results.filter((item) => item.status === 'failed');
  const summary = [
    `## Execução automática · ${phase}`,
    '',
    `- Run: \`${runId}\``,
    `- Empresa: **${report.companyMarker}**`,
    `- Obra segura: **${report.project || report.projectCode}**`,
    `- Prefixo obrigatório: \`${report.recordPrefix}\``,
    `- Telas verificadas: **${report.total}**`,
    `- Aprovadas: **${report.passed}**`,
    `- Falhas: **${report.failed}**`,
    '',
    startupError ? `### Falha de inicialização\n- ${startupError}` : '',
    !startupError && failures.length ? '### Falhas' : '',
    ...failures.map((item) => `- \`${item.route}\`: ${item.error}`),
    !startupError && failures.length === 0 ? '✅ Nenhuma falha de abertura detectada.' : ''
  ].filter(Boolean).join('\n');
  await postIssueComment(summary).catch(() => {});

  if (startupError) throw new Error(startupError);
  return report;
}
