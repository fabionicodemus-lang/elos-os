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

async function login(page, baseUrl) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('E-mail').fill(required('ELOS_TEST_EMAIL'));
  await page.getByLabel('Senha').fill(required('ELOS_TEST_PASSWORD'));
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.getByRole('button', { name: 'Entrar no Elos OS' }).click().catch(async () => {
      await page.getByRole('button', { name: 'Entrar' }).click();
    })
  ]);
}

async function assertHomologationContext(page) {
  const body = (await page.locator('body').innerText()).toUpperCase();
  const safeMarker = (process.env.HOMOLOGATION_MARKER || 'HORIZONTE TESTES').toUpperCase();
  const blocked = ['FLOW · FLOW APTOS', 'ALMA', 'BOSSA EMPREENDIMENTOS'];
  if (!body.includes(safeMarker)) {
    throw new Error(`Contexto seguro não confirmado. Marcador ausente: ${safeMarker}`);
  }
  for (const value of blocked) {
    if (body.includes(value) && !body.includes(safeMarker)) {
      throw new Error(`Execução bloqueada por contexto real detectado: ${value}`);
    }
  }
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

  try {
    await login(page, baseUrl);
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await assertHomologationContext(page);

    for (const route of ROUTES) {
      const started = Date.now();
      const result = { route, status: 'passed', durationMs: 0, title: '', error: null, screenshot: null };
      try {
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 30_000 });
        result.title = await page.title();
        if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status() ?? 'sem resposta'}`);
        if (page.url().includes('/login')) throw new Error('Sessão redirecionada para login');
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
        result.error = error instanceof Error ? error.message : String(error);
        const filename = `FAIL_${route.replaceAll('/', '_').replace(/^_/, '') || 'dashboard'}.png`;
        const screenshot = path.join(outputDir, filename);
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
        result.screenshot = screenshot;
      }
      result.durationMs = Date.now() - started;
      results.push(result);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    runId,
    phase,
    startedAt: runId,
    baseUrl,
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results
  };
  await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));

  const failures = results.filter((item) => item.status === 'failed');
  const summary = [
    `## Execução automática · ${phase}`,
    '',
    `- Run: \`${runId}\``,
    `- Telas verificadas: **${report.total}**`,
    `- Aprovadas: **${report.passed}**`,
    `- Falhas: **${report.failed}**`,
    '',
    failures.length ? '### Falhas' : '✅ Nenhuma falha de abertura detectada.',
    ...failures.map((item) => `- \`${item.route}\`: ${item.error}`)
  ].join('\n');
  await postIssueComment(summary).catch(() => {});
  return report;
}
